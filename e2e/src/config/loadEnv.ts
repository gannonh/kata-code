import { loadRepoEnv } from "../../../scripts/lib/public-config.ts";

Object.assign(process.env, loadRepoEnv());
