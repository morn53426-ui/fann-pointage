-- Ajout indépendant du nouveau régime afin que PostgreSQL rende la valeur visible aux migrations suivantes.
ALTER TYPE regime_code ADD VALUE IF NOT EXISTS 'mobil';
