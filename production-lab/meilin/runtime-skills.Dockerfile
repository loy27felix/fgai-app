# Build context: production-lab. Reuse the verified media runtimes and add company packages.
ARG CREATOR_BASE
ARG ARCREEL_BASE
FROM alpine:3.22 AS company-skills
COPY yingce/canvas/backend/builtin /source
RUN mkdir /skills && for package in /source/fg-*; do cp -R "$package" /skills/; done && printf 'fg-1.3.0-31\n' > /skills/version

FROM ${CREATOR_BASE} AS creator
COPY --from=company-skills /skills /opt/fg-skills
COPY opencreator/deploy/entry.mjs /app/fg-entry.mjs
RUN node --check /app/fg-entry.mjs

FROM ${ARCREEL_BASE} AS arcreel
USER root
COPY --from=company-skills /skills /opt/fg-skills
RUN for package in /opt/fg-skills/fg-*; do cp -R "$package" /app/agent_runtime_profile/.claude/skills/; done
USER fg
