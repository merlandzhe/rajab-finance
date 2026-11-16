CREATE OR REPLACE FUNCTION private.contract_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- Terms, parties, schedules, and amounts are immutable once created.
  IF (to_jsonb(NEW) - ARRAY['status','transferred_on','transfer_reference','accepted_at'])
     IS DISTINCT FROM
     (to_jsonb(OLD) - ARRAY['status','transferred_on','transfer_reference','accepted_at']) THEN
    RAISE EXCEPTION 'Цена и условия заключённого договора неизменяемы';
  END IF;

  -- A buyer may accept a pending draft once, storing the acceptance instant.
  IF NEW.accepted_at IS DISTINCT FROM OLD.accepted_at THEN
    IF NOT (
      OLD.status = 'awaiting_acceptance'
      AND NEW.status = 'signed'
      AND OLD.accepted_at IS NULL
      AND NEW.accepted_at IS NOT NULL
    ) THEN
      RAISE EXCEPTION 'Дата подтверждения договора неизменяема';
    END IF;
  END IF;
  RETURN NEW;
END
$$;
