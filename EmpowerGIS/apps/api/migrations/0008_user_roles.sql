DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'users'
      AND column_name = 'user_role'
  ) THEN
    ALTER TABLE users
    ADD COLUMN user_role TEXT NOT NULL DEFAULT 'user';
  END IF;
END
$$;

UPDATE users
SET user_role = 'user'
WHERE user_role IS NULL;

ALTER TABLE users
DROP CONSTRAINT IF EXISTS users_user_role_check;

ALTER TABLE users
ADD CONSTRAINT users_user_role_check CHECK (user_role IN ('user', 'admin'));

CREATE INDEX IF NOT EXISTS idx_users_user_role
ON users (user_role);

-- Ensure at least one admin exists for first admin login.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM users WHERE user_role = 'admin') THEN
    UPDATE users
    SET user_role = 'admin'
    WHERE id = (
      SELECT id
      FROM users
      ORDER BY created_at ASC, id ASC
      LIMIT 1
    );
  END IF;
END
$$;
