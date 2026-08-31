from django.contrib import admin

from .models import Question, Section, Template, TemplateVersion


class SectionInline(admin.TabularInline):
    model = Section
    extra = 0


@admin.register(Template)
class TemplateAdmin(admin.ModelAdmin):
    list_display = ('name', 'created_by', 'is_archived', 'created_at')
    search_fields = ('name',)


@admin.register(TemplateVersion)
class TemplateVersionAdmin(admin.ModelAdmin):
    list_display = ('template', 'version_number', 'status', 'published_at')
    list_filter = ('status',)
    inlines = [SectionInline]


@admin.register(Section)
class SectionAdmin(admin.ModelAdmin):
    list_display = ('title', 'template_version', 'order')


@admin.register(Question)
class QuestionAdmin(admin.ModelAdmin):
    list_display = ('label', 'section', 'question_type', 'order', 'is_required')
    list_filter = ('question_type',)
