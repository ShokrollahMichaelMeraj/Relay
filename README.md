# Relay

## Overview
Relay is a multi-agent orchestration system for running complex, dependency-aware AI workflows.
Instead of juggling dozens of chats, Relay lets you define goals, tasks, and dependencies once, then executes them deterministically using multiple AI agents.


## Documentation:

## Road Map


## System Architecture

``` Relay
├── apps
│   ├── api
│   │   ├── package.json
│   │   ├── src
│   │   │   ├── config
│   │   │   │   └── env.ts
│   │   │   ├── db
│   │   │   │   └── index.ts
│   │   │   ├── main.ts
│   │   │   ├── middleware
│   │   │   │   └── auth.ts
│   │   │   ├── orchestrator
│   │   │   │   ├── dag.ts
│   │   │   │   ├── reaper.ts
│   │   │   │   ├── scheduler.ts
│   │   │   │   └── sql.ts
│   │   │   ├── queue
│   │   │   │   ├── eventConsumer.ts
│   │   │   │   └── producer.ts
│   │   │   ├── routes
│   │   │   │   ├── runs.ts
│   │   │   │   ├── taskRuns.ts
│   │   │   │   └── workflows.ts
│   │   │   ├── services
│   │   │   │   ├── runService.ts
│   │   │   │   ├── taskRunService.ts
│   │   │   │   └── workflowService.ts
│   │   │   └── util
│   │   │       ├── errors.ts
│   │   │       ├── ids.ts
│   │   │       └── logger.ts
│   │   └── tsconfig.json
│   ├── cli
│   │   ├── package.json
│   │   ├── src
│   │   │   ├── api
│   │   │   │   └── client.ts
│   │   │   ├── commands
│   │   │   │   ├── approve.ts
│   │   │   │   ├── init.ts
│   │   │   │   ├── logs.ts
│   │   │   │   ├── run.ts
│   │   │   │   ├── status.ts
│   │   │   │   └── validate.ts
│   │   │   ├── config
│   │   │   │   ├── loadWorkflow.ts
│   │   │   │   └── schema.ts
│   │   │   ├── main.ts
│   │   │   └── util
│   │   │       ├── exitCodes.ts
│   │   │       └── printer.ts
│   │   └── tsconfig.json
│   ├── web
│   │   ├── next.config.js
│   │   ├── package.json
│   │   ├── src
│   │   │   ├── api
│   │   │   │   └── client.ts
│   │   │   ├── components
│   │   │   │   ├── RunGraph.tsx
│   │   │   │   ├── StatusPill.tsx
│   │   │   │   └── TaskPanel.tsx
│   │   │   └── pages
│   │   │       ├── index.tsx
│   │   │       └── runs
│   │   │           └── [runId].tsx
│   │   └── tsconfig.json
│   └── worker
│       ├── package.json
│       ├── src
│       │   ├── config
│       │   │   └── env.ts
│       │   ├── connectors
│       │   │   ├── anthropic.ts
│       │   │   ├── index.ts
│       │   │   └── openai.ts
│       │   ├── db
│       │   │   └── index.ts
│       │   ├── exec
│       │   │   ├── jsonExtract.ts
│       │   │   ├── promptEnvelope.ts
│       │   │   ├── renderPrompt.ts
│       │   │   ├── resolveInputs.ts
│       │   │   ├── retryPolicy.ts
│       │   │   └── validateJson.ts
│       │   ├── main.ts
│       │   ├── queue
│       │   │   └── consumer.ts
│       │   └── util
│       │       └── logger.ts
│       └── tsconfig.json
├── docs
│   └── Documentation.md
├── infra
│   ├── docker-compose.yml
│   ├── migrations
│   │   └── 001_init.sql
│   ├── postgres
│   │   └── init.sql
│   └── redis
│       └── redis.conf
├── LICENSE
├── package.json
├── packages
│   ├── core
│   │   ├── package.json
│   │   ├── src
│   │   │   ├── constants
│   │   │   ├── dag
│   │   │   │   ├── build.ts
│   │   │   │   ├── topo.ts
│   │   │   │   └── validate.ts
│   │   │   ├── engine
│   │   │   │   ├── state.ts
│   │   │   │   └── unlock.ts
│   │   │   └── workflow
│   │   │       ├── normalize.ts
│   │   │       └── types.ts
│   │   └── tsconfig.json
│   └── types
│       ├── package.json
│       ├── src
│       │   ├── api.ts
│       │   └── db.ts
│       └── tsconfig.json
├── pnpm-workspace.yaml
├── README.md
├── scripts
│   ├── dev.sh
│   └── migrate.sh
├── tsconfig.base.json
├── workflows
│   ├── demo_code.yaml
│   ├── demo_content.yaml
│   └── demo_prd.yaml
├──.gitignore
│ 
└──.env.example ```

