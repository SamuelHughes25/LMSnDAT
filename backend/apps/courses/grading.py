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

# Public: which slide_type values are actually gradable/interactive, for
# CourseAttemptViewSet.complete() to enumerate every assessment slide a
# course has — not just the ones a learner happened to submit a SlideResult
# for. A slide type with no grader (content, or any future type not yet
# wired above) never contributes a SlideResult row at all (its present-mode
# component never calls onInteraction), so it's correctly excluded here too.
GRADABLE_SLIDE_TYPES = frozenset(_GRADERS)


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
