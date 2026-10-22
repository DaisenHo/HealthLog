-- Extend `measurement_type` with room-climate readings pushed through the
-- ingest token (source EXTERNAL), for example by a Home Assistant
-- automation: indoor CO2 (ppm), indoor temperature (celsius) and indoor
-- relative humidity (percent).
--
-- Purely additive. IF NOT EXISTS keeps a replay harmless; enum values cannot
-- be dropped in PostgreSQL, so there is no down path.

ALTER TYPE "measurement_type" ADD VALUE IF NOT EXISTS 'INDOOR_CO2';
ALTER TYPE "measurement_type" ADD VALUE IF NOT EXISTS 'INDOOR_TEMPERATURE';
ALTER TYPE "measurement_type" ADD VALUE IF NOT EXISTS 'INDOOR_HUMIDITY';
