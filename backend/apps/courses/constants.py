from django.db import models


class SlideType(models.TextChoices):
    CONTENT = 'content', 'Content'
    MULTIPLE_CHOICE = 'multiple_choice', 'Multiple choice'
    CATEGORIZE = 'categorize', 'Categorize'
    MISSING_WORD = 'missing_word', 'Missing word'
    MATCH_PAIRS = 'match_pairs', 'Match the pair'
    ACCORDION = 'accordion', 'Dropdown / Accordion'
    FLASHCARDS = 'flashcards', 'Flashcards'
    SEQUENCING = 'sequencing', 'Sequencing'
    HOTSPOT_IMAGE = 'hotspot_image', 'Hotspot image'
    SURVEY_RATING = 'survey_rating', 'Survey / rating'
    NUMBER_SLIDER = 'number_slider', 'Number'
    # Enum only, not buildable yet — excluded from the add-slide menu / editor
    # dispatch table until a later pass. See docs/PROJECT_LOG.md.
    GAME_RAPID_FIRE = 'game_rapid_fire', 'Rapid fire game'


class TransitionStyle(models.TextChoices):
    NONE = 'none', 'None'
    FADE = 'fade', 'Fade'
    SLIDE = 'slide', 'Slide'


class AssetKind(models.TextChoices):
    IMAGE = 'image', 'Image'
    VIDEO = 'video', 'Video'
    OTHER = 'other', 'Other'
