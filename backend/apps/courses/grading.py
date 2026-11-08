"""Server-authoritative grading for interactive slides.

Some courses built with these slide types are legally-binding compliance
training (asbestos, GDPR, and similar) — a passing score has to mean the
learner actually demonstrated the right answer, not that their browser
merely asserted `isCorrect: true`. Every present-mode slide face already
sends a raw, type-specific `detail` payload to `onInteraction` (unchanged
by this module — see frontend/src/lib/slide-interaction.ts); this is the
one and only place that payload gets turned into a real is_correct/score,
by comparing it against the slide's own `config` (the answer key) as
currently stored in the database. `SlideResult.save()` is the sole caller
— nothing here ever trusts a client-submitted correctness claim.

Slides are never edited after their CourseVersion is published (course
authoring always goes through a fresh draft — see CourseVersion's
one-draft-per-course constraint), so `slide.config` read here is always
the exact content the learner actually saw.
"""

import re


def _multiple_choice(config, detail):
    options = config.get('options') or []
    selected_id = (detail or {}).get('selectedOptionId')
    if selected_id is None:
        return False, 0.0
    correct_ids = {o.get('id') for o in options if isinstance(o, dict) and o.get('is_correct')}
    is_correct = selected_id in correct_ids
    return is_correct, 1.0 if is_correct else 0.0


def _missing_word(config, detail):
    blanks = config.get('blanks') or []
    if not blanks:
        return False, 0.0
    placements = (detail or {}).get('placements') or {}
    correct_count = sum(
        1 for b in blanks if isinstance(b, dict) and placements.get(b.get('id')) == b.get('id')
    )
    score = correct_count / len(blanks)
    return score == 1.0, score


def _sequencing(config, detail):
    items = config.get('sequence_items') or []
    if not items:
        return False, 0.0
    correct_ids = [it.get('id') for it in items if isinstance(it, dict)]
    final_order = (detail or {}).get('finalOrder') or []
    # Reject outright (rather than partially grade) anything that isn't an
    # exact permutation of the config's ids — defends against a malformed
    # or hand-crafted direct-API-call payload, not just normal UI use.
    if not isinstance(final_order, list) or sorted(final_order) != sorted(correct_ids):
        return False, 0.0
    index_by_id = {item_id: i for i, item_id in enumerate(correct_ids)}
    correct_count = sum(1 for i, item_id in enumerate(final_order) if index_by_id.get(item_id) == i)
    score = correct_count / len(items)
    return score == 1.0, score


def _match_pairs(config, detail):
    """Distinct from the generic `_id_set_covers` graders below because this
    type can now genuinely be PARTIALLY wrong — unlike accordion/hotspot_image
    (open-everything/find-everything, no notion of a wrong choice),
    match_pairs' frontend (assessment mode) permanently records every
    keyword's assigned definition, right or wrong, in `detail['pairings']`
    (a full map, one entry per keyword that's been clicked so far — shape
    mirrors missing_word's `placements`). A keyword id mapped to its own id
    means it landed on its correct definition (same "shared id = correct
    pair" convention as missing_word). Score is the fraction of the slide's
    pairs correctly matched; a mismatch anywhere means this can never reach
    1.0, matching the frontend's "one wrong pairing fails the whole slide"
    design without needing a `matchedPairIds`-style boolean anywhere.
    """
    pairs = config.get('pairs') or []
    pair_ids = {p.get('id') for p in pairs if isinstance(p, dict)}
    if not pair_ids:
        return False, 0.0
    pairings = (detail or {}).get('pairings') or {}
    if not isinstance(pairings, dict):
        return False, 0.0
    correct_count = sum(1 for k, v in pairings.items() if k in pair_ids and v == k)
    score = correct_count / len(pair_ids)
    return score == 1.0, score


def _id_set_covers(config_key, detail_key):
    """Builds a grader for the three "find/open/match everything" types:
    correct iff the submitted id-set is a superset of every id in config.
    """

    def grader(config, detail):
        items = config.get(config_key) or []
        required_ids = {it.get('id') for it in items if isinstance(it, dict)}
        if not required_ids:
            return False, 0.0
        submitted_ids = set((detail or {}).get(detail_key) or [])
        is_correct = required_ids <= submitted_ids
        return is_correct, 1.0 if is_correct else 0.0

    return grader


def _flashcards(config, detail):
    cards = config.get('cards') or []
    if not cards:
        return False, 0.0
    # Only a count is ever sent (not which cards) — a known, deliberate,
    # lower-stakes limitation: self-paced review content with no "wrong
    # answer" concept, unlike the genuinely graded types above.
    viewed = (detail or {}).get('cardsViewed') or 0
    is_correct = isinstance(viewed, (int, float)) and not isinstance(viewed, bool) and viewed >= len(cards)
    return is_correct, 1.0 if is_correct else 0.0


_GRADERS = {
    'multiple_choice': _multiple_choice,
    'missing_word': _missing_word,
    'sequencing': _sequencing,
    'match_pairs': _match_pairs,
    'accordion': _id_set_covers('sections', 'sectionsOpened'),
    'hotspot_image': _id_set_covers('hotspots', 'foundHotspotIds'),
    'flashcards': _flashcards,
}

# Public: every slide_type that has a grader wired above and therefore
# produces a real SlideResult row at all (a type with no grader — content,
# or any future type not yet wired here — never contributes one; its
# present-mode component never calls onInteraction in the first place).
GRADABLE_SLIDE_TYPES = frozenset(_GRADERS)

# The SUBSET of GRADABLE_SLIDE_TYPES that are genuine questions with a
# reachable wrong answer: multiple_choice/missing_word/sequencing/match_pairs
# all let a learner submit something incorrect. accordion/hotspot_image
# (via _id_set_covers) and flashcards are deliberately excluded — they're
# self-paced "view every section/find every hotspot/flip every card"
# completion gates, structurally incapable of ever grading as wrong (their
# present-mode components only call onInteraction once EVERY element has
# been visited), so is_correct is always True once they fire at all. Treating
# them as scoreable questions — which is what happened before this constant
# existed — silently inflated every course's score/pass-fail with a handful
# of guaranteed-free points and mislabeled pure interactivity as an
# assessment question. Used by CourseAttemptViewSet.complete() for the
# score/pass-fail denominator, and mirrored on the frontend
# (course-types.ts's QUESTION_SLIDE_TYPES) for the analytics breakdown.
SCORABLE_SLIDE_TYPES = frozenset({'multiple_choice', 'missing_word', 'sequencing', 'match_pairs'})


def grade_slide(slide, detail):
    """Returns (is_correct: bool, score: float in [0, 1]) computed purely
    from `slide.config` and the submitted `detail` — never from anything
    else the client might send. Slide types with no grader (content, or
    any future type not yet wired here) never actually reach this — their
    present-mode components never call onInteraction in the first place —
    but grade as unconditionally incorrect/zero rather than raising, so a
    stray call can't crash the results endpoint.
    """
    grader = _GRADERS.get(slide.slide_type)
    if grader is None:
        return False, 0.0
    config = slide.config or {}
    return grader(config, detail if isinstance(detail, dict) else {})


_HTML_TAG_RE = re.compile(r'<[^>]*>')


def _has_real_text(value):
    return isinstance(value, str) and bool(_HTML_TAG_RE.sub(' ', value).strip())


def slide_is_configured(slide):
    """Whether a SCORABLE_SLIDE_TYPES slide actually has the minimum real
    content needed to BE a question, as opposed to an empty placeholder a
    course author added in the builder and never finished (a blank
    question, a missing_word slide with no blanks defined, etc). Reported
    directly: a course with two such unfinished placeholder slides left in
    its published version was permanently docking a learner two points off
    their score for questions they were never actually capable of
    answering right or wrong — SCORABLE_SLIDE_TYPES membership alone isn't
    enough, since that's a property of the slide TYPE, not of whether this
    particular slide instance was ever actually finished being authored.

    missing_word/sequencing/match_pairs already refuse to grade an empty
    one as correct (see each one's own early return above) — reused here
    so emptiness is only ever defined once. multiple_choice has no
    equivalent case in its own grader (a blank `question` with real,
    correctly-flagged options still grades the selection normally), so
    it's checked here instead: the builder's own MultipleChoiceStatic
    (course-builder/slide-faces/multiple-choice-slide-face.tsx) always
    renders a literal "Click to add question"/"Untitled question"
    placeholder when this is blank — there's no other way for a learner to
    even know what's being asked, so a blank one was never a real
    question. sequencing/match_pairs' own `instructions` field is
    deliberately NOT checked the same way as multiple_choice's `question`
    — unlike that field, `instructions` is optional even on a fully real,
    intentional question (see e.g. match-pairs-slide-face.tsx's own
    conditional rendering, which only shows it at all when non-empty), so
    an empty one there says nothing about whether the slide is finished.
    """
    config = slide.config or {}
    if slide.slide_type == 'multiple_choice':
        return _has_real_text(config.get('question'))
    content_key = {'missing_word': 'blanks', 'sequencing': 'sequence_items', 'match_pairs': 'pairs'}.get(
        slide.slide_type,
    )
    if content_key is None:
        return False
    return bool(config.get(content_key))
