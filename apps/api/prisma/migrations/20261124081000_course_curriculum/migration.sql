BEGIN;
-- AlterEnum
ALTER TYPE "LessonKind" ADD VALUE 'PDF';

-- AlterTable
ALTER TABLE "Course" ADD COLUMN     "instructor" TEXT,
ADD COLUMN     "learningObjectives" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "CourseModule" ADD COLUMN     "archivedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Lesson" ADD COLUMN     "archivedAt" TIMESTAMP(3);

COMMIT;
