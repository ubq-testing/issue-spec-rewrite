import * as github from "@actions/github";
import { Octokit } from "@octokit/rest";
import { Value } from "@sinclair/typebox/value";
import { createClient } from "@supabase/supabase-js";
import { createAdapters } from "./adapters";
import { Database } from "./adapters/supabase/types/database";
import { Context } from "./types/context";
import { envSchema } from "./types/env";
import { pluginSettingsSchema, PluginInputs } from "./types/plugin-inputs";

async function setup() {
  const payload = github.context.payload.inputs;

  const env = Value.Decode(envSchema, process.env);
  const settings = Value.Decode(pluginSettingsSchema, JSON.parse(payload.settings));

  const inputs: PluginInputs = {
    stateId: payload.stateId,
    eventName: payload.eventName,
    eventPayload: JSON.parse(payload.eventPayload),
    settings,
    authToken: env.GITHUB_TOKEN,
    ref: payload.ref,
  };

  const octokit = new Octokit({ auth: inputs.authToken });
  const supabase = createClient<Database>(env.SUPABASE_URL, env.SUPABASE_KEY);

  const context: Context = {
    eventName: inputs.eventName,
    payload: inputs.eventPayload,
    config: inputs.settings,
    octokit,
    env,
    logger: {
      debug(message: unknown, ...optionalParams: unknown[]) {
        console.debug(message, ...optionalParams);
      },
      info(message: unknown, ...optionalParams: unknown[]) {
        console.log(message, ...optionalParams);
      },
      warn(message: unknown, ...optionalParams: unknown[]) {
        console.warn(message, ...optionalParams);
      },
      error(message: unknown, ...optionalParams: unknown[]) {
        console.error(message, ...optionalParams);
      },
      fatal(message: unknown, ...optionalParams: unknown[]) {
        console.error(message, ...optionalParams);
      },
    },
    adapters: {} as ReturnType<typeof createAdapters>,
  };

  context.adapters = createAdapters(supabase, context);

  return context;
}

export default async function plugin() {
  const context = await setup();

  // Add your plugin logic here
  context.logger.info("Hello, World!");
}
