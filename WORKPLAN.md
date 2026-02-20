# Rewebz Autonomous Build Plan (Template-free generation)

Last updated: 2026-02-21 03:10 KST

## Goal
신청이 들어오면 업체별로 **완전히 신규 기획/디자인/개발 소스**를 생성하고,
검수 후 `{slug}.rewebz.com`으로 배포하는 파이프라인 구축.

## Status Model
`NEW -> BRIEF_READY -> GENERATED -> QA_PASSED -> APPROVED -> LIVE`

## Phase 1 (Tonight)
- [ ] Define `project-brief` JSON schema
- [ ] Build generator entrypoint (`scripts/generate-site.js`)
- [ ] Create per-site folder convention (`sites/{slug}`)
- [ ] Add QA script (`scripts/qa-site.js`)
- [ ] Add deploy script (`scripts/deploy-site.js`)
- [ ] Add state updater (Google Sheet status transitions)

## Phase 2
- [ ] Wire worker to call generator for NEW requests
- [ ] Save generated artifacts + preview URL
- [ ] Add human review gate command
- [ ] Approve -> deploy -> DNS/Vercel domain attach

## Constraints
- No static template copy flow
- Every project gets fresh source in `sites/{slug}`
- Keep all changes committed in common git repo

## Tracking
- Progress log: `logs/autobuild.log`
- Runner: `scripts/autobuild-runner.sh`
- Cron: every 5 minutes
