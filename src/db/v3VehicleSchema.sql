CREATE TABLE IF NOT EXISTS v3_device_vehicles (
  id           SERIAL PRIMARY KEY,
  device_id    VARCHAR NOT NULL REFERENCES v3_devices(device_id) ON DELETE CASCADE,
  user_id      INT REFERENCES v3_users(user_id) ON DELETE CASCADE,   -- nullable: guest vehicle selection is keyed by device_id
  selected_car JSONB,
  updated_at   TIMESTAMP DEFAULT NOW(),
  UNIQUE (device_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_v3_device_vehicles_device_id ON v3_device_vehicles(device_id);
CREATE INDEX IF NOT EXISTS idx_v3_device_vehicles_user_id ON v3_device_vehicles(user_id);
-- UNIQUE(device_id, user_id) does not dedupe NULL user_id rows (NULL <> NULL in Postgres),
-- so a guest device needs its own partial unique index to enforce one selected car per device.
CREATE UNIQUE INDEX IF NOT EXISTS idx_v3_device_vehicles_guest ON v3_device_vehicles(device_id) WHERE user_id IS NULL;
