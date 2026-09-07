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
    'match_pairs': _id_set_covers('pairs', 'matchedPairIds'),
    'accordion': _id_set_covers('sections', 'sectionsOpened'),
    'hotspot_image': _id_set_covers('hotspots', 'foundHotspotIds'),
    'flashcards': _flashcards,
}


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
