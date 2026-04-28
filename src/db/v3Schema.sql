CREATE TABLE IF NOT EXISTS v3_devices (
  id          SERIAL PRIMARY KEY,
  device_id   VARCHAR UNIQUE NOT NULL,
  platform    TEXT,
  app_version TEXT,
  open_count  INT DEFAULT 0,
  close_count INT DEFAULT 0,
  created_at  TIMESTAMP DEFAULT NOW(),
  last_seen   TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS v3_users (
  id            SERIAL PRIMARY KEY,
  user_id       INT UNIQUE NOT NULL,
  email         VARCHAR UNIQUE NOT NULL,
  corenio_token TEXT,
  token_expires TIMESTAMP,
  created_at    TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS v3_device_sessions (
  id         SERIAL PRIMARY KEY,
  device_id  VARCHAR NOT NULL REFERENCES v3_devices(device_id),
  user_id    INT NOT NULL REFERENCES v3_users(user_id),
  proxy_key  TEXT NOT NULL,
  server_key VARCHAR UNIQUE NOT NULL,
  authorised BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT NOW(),
  last_auth  TIMESTAMP DEFAULT NOW(),
  UNIQUE (device_id, user_id)
);

CREATE TABLE IF NOT EXISTS v3_device_analytics (
  id           SERIAL PRIMARY KEY,
  device_id    VARCHAR NOT NULL REFERENCES v3_devices(device_id),
  user_id      INT REFERENCES v3_users(user_id),
  event        VARCHAR NOT NULL CHECK (event IN ('open','close','request','search','product_view','category_view','vehicle_search','order_created','order_view')),
  request_path VARCHAR,
  meta         JSONB,
  created_at   TIMESTAMP DEFAULT NOW()
);
