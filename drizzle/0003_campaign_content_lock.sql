CREATE OR REPLACE FUNCTION lock_active_campaign_content() RETURNS trigger AS $$
DECLARE
  campaign_uuid uuid;
  current_status campaign_status;
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.campaign_id IS DISTINCT FROM NEW.campaign_id THEN
    FOR campaign_uuid IN
      SELECT id FROM campaigns WHERE id IN (OLD.campaign_id, NEW.campaign_id) ORDER BY id
    LOOP
      SELECT status INTO current_status FROM campaigns WHERE id = campaign_uuid FOR UPDATE;
      IF current_status = 'ACTIVE' THEN
        RAISE EXCEPTION 'Campaign content cannot be edited while ACTIVE; pause it first.'
          USING ERRCODE = 'check_violation', CONSTRAINT = 'active_campaign_content_immutable';
      END IF;
    END LOOP;
  ELSE
    campaign_uuid := CASE WHEN TG_OP = 'DELETE' THEN OLD.campaign_id ELSE NEW.campaign_id END;
    SELECT status INTO current_status FROM campaigns WHERE id = campaign_uuid FOR UPDATE;
    IF current_status = 'ACTIVE' THEN
      RAISE EXCEPTION 'Campaign content cannot be edited while ACTIVE; pause it first.'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'active_campaign_content_immutable';
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER campaign_buttons_lock_active BEFORE INSERT OR UPDATE OR DELETE ON campaign_buttons
  FOR EACH ROW EXECUTE FUNCTION lock_active_campaign_content();
--> statement-breakpoint
CREATE TRIGGER campaign_activities_lock_active BEFORE INSERT OR UPDATE OR DELETE ON campaign_activities
  FOR EACH ROW EXECUTE FUNCTION lock_active_campaign_content();
--> statement-breakpoint
CREATE TRIGGER campaign_messages_lock_active BEFORE INSERT OR UPDATE OR DELETE ON campaign_messages
  FOR EACH ROW EXECUTE FUNCTION lock_active_campaign_content();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION prevent_direct_active_campaign_mutation() RETURNS trigger AS $$
BEGIN
  IF OLD.status = 'ACTIVE' AND NEW.status = 'ACTIVE' AND
    (NEW.code, NEW.name, NEW.template_type, NEW.claim_policy, NEW.title, NEW.subtitle,
     NEW.reward_type, NEW.reward_value, NEW.hero_image, NEW.start_at, NEW.end_at,
     NEW.max_claims, NEW.settings) IS DISTINCT FROM
    (OLD.code, OLD.name, OLD.template_type, OLD.claim_policy, OLD.title, OLD.subtitle,
     OLD.reward_type, OLD.reward_value, OLD.hero_image, OLD.start_at, OLD.end_at,
     OLD.max_claims, OLD.settings) THEN
    RAISE EXCEPTION 'Campaign content cannot be edited while ACTIVE; pause it first.'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'active_campaign_content_immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER campaign_lock_active BEFORE UPDATE ON campaigns
  FOR EACH ROW EXECUTE FUNCTION prevent_direct_active_campaign_mutation();
