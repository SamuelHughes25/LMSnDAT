from django.db import models


class QuestionType(models.TextChoices):
    TEXT = 'text', 'Text'
    NUMBER = 'number', 'Number'
    BOOLEAN = 'boolean', 'Yes/No'
    SINGLE_SELECT = 'single_select', 'Single select'
    MULTI_SELECT = 'multi_select', 'Multi select'
    DATE = 'date', 'Date'
    PHOTO = 'photo', 'Photo evidence'
    SIGNATURE = 'signature', 'Signature'
    GPS = 'gps', 'GPS / location'
    BARCODE = 'barcode', 'Barcode / QR scan'
    SECTION_HEADER = 'section_header', 'Section header'
    INSTRUCTION = 'instruction', 'Instruction block'


# section_header / instruction are display-only and never produce an Answer.
ANSWERABLE_TYPES = {
    QuestionType.TEXT,
    QuestionType.NUMBER,
    QuestionType.BOOLEAN,
    QuestionType.SINGLE_SELECT,
    QuestionType.MULTI_SELECT,
    QuestionType.DATE,
    QuestionType.PHOTO,
    QuestionType.SIGNATURE,
    QuestionType.GPS,
    QuestionType.BARCODE,
}

SELECT_TYPES = {QuestionType.SINGLE_SELECT, QuestionType.MULTI_SELECT}
