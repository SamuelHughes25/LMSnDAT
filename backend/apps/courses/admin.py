from django.contrib import admin

from .models import Course, CourseAsset, CourseVersion, Lesson, Slide


class LessonInline(admin.TabularInline):
    model = Lesson
    extra = 0


@admin.register(Course)
class CourseAdmin(admin.ModelAdmin):
    list_display = ('name', 'created_by', 'is_archived', 'created_at')
    search_fields = ('name',)


@admin.register(CourseVersion)
class CourseVersionAdmin(admin.ModelAdmin):
    list_display = ('course', 'version_number', 'status', 'transition_style', 'published_at')
    list_filter = ('status',)
    inlines = [LessonInline]


@admin.register(Lesson)
class LessonAdmin(admin.ModelAdmin):
    list_display = ('title', 'course_version', 'order')


@admin.register(Slide)
class SlideAdmin(admin.ModelAdmin):
    list_display = ('title', 'lesson', 'slide_type', 'order')
    list_filter = ('slide_type',)


@admin.register(CourseAsset)
class CourseAssetAdmin(admin.ModelAdmin):
    list_display = ('file', 'course_version', 'kind', 'uploaded_by', 'created_at')
    list_filter = ('kind',)
