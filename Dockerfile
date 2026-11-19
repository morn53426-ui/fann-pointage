# Image minimale pour le catalogue PostgreSQL ou la démonstration explicitement sélectionnée. Elle n'embarque aucun secret.
FROM node:22.23.4-bookworm-slim

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8787

WORKDIR /app

# package*.json copie package.json et, lorsqu'il existe, package-lock.json.
# Preserve "type": "module" so Node treats .ts entrypoints as ES modules.
COPY --chown=node:node package*.json ./

# Dépendances dans l'image, jamais copiées du poste Windows. npm ci sera utilisé dès qu'un lockfile est livré.
RUN if [ -f package-lock.json ]; then npm ci --omit=dev --ignore-scripts --no-audit --no-fund; \
    else npm install --omit=dev --ignore-scripts --no-audit --no-fund; fi
COPY --chown=node:node src ./src
COPY --chown=node:node web ./web
# Outils de migration (service « migrate » de compose.yaml) : migrations SQL + scripts d'application des droits.
COPY --chown=node:node scripts/migrate-catalogue.mjs scripts/configurer-role-application.mjs scripts/grant-runtime-role.sql ./scripts/
COPY --chown=node:node supabase/migrations ./supabase/migrations

# Le volume local reste accessible à l'utilisateur non privilégié ; le registre courant est dans PostgreSQL.
RUN mkdir -p /data && chown node:node /data

USER node
EXPOSE 8787

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:8787/readyz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]

CMD ["node", "--experimental-strip-types", "src/api/entrypoint.ts"]
