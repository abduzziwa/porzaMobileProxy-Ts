CREATE TABLE IF NOT EXISTS v3_device_vehicles (
  id           SERIAL PRIMARY KEY,
  device_id    VARCHAR NOT NULL REFERENCES v3_devices(device_id) ON DELETE CASCADE,
  user_id      INT NOT NULL REFERENCES v3_users(user_id) ON DELETE CASCADE,
  selected_car JSONB,
  updated_at   TIMESTAMP DEFAULT NOW(),
  UNIQUE (device_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_v3_device_vehicles_device_id ON v3_device_vehicles(device_id);
CREATE INDEX IF NOT EXISTS idx_v3_device_vehicles_user_id ON v3_device_vehicles(user_id);
