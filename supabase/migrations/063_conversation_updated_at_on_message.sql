-- Migration 63: Update conversation.updated_at when a message is inserted so sidebar sort by updated_at reflects recent activity
CREATE OR REPLACE FUNCTION touch_conversation_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE conversations
  SET updated_at = NOW()
  WHERE id = NEW.conversation_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS touch_conversation_on_message ON messages;
CREATE TRIGGER touch_conversation_on_message
  AFTER INSERT ON messages
  FOR EACH ROW
  EXECUTE FUNCTION touch_conversation_updated_at();
