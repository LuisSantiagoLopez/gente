-- AlterTable
ALTER TABLE "action_auto_review_preferences" ADD COLUMN "autoApprove" JSONB;

-- AlterTable
ALTER TABLE "user_action_auto_review_preferences" ADD COLUMN "autoApprove" JSONB;
