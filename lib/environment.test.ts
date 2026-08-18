import { test, afterEach } from "node:test"
import assert from "node:assert/strict"
import {
  assertSafeToMutateProductionData,
  deploymentEnvironment,
  isProductionDeployment,
  isWiredToProductionData,
  ProductionDataWriteError,
} from "./environment.ts"

const ORIGINAL = { ...process.env }

afterEach(() => {
  for (const key of ["VERCEL_ENV", "NODE_ENV", "DATA_ENVIRONMENT"]) {
    if (key in ORIGINAL) process.env[key] = ORIGINAL[key]
    else delete process.env[key]
  }
})

function setEnv(env: Record<string, string | undefined>) {
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
}

test("VERCEL_ENV decides the deployment environment", () => {
  setEnv({ VERCEL_ENV: "production" })
  assert.equal(deploymentEnvironment(), "production")

  setEnv({ VERCEL_ENV: "preview" })
  assert.equal(deploymentEnvironment(), "preview")

  setEnv({ VERCEL_ENV: "development" })
  assert.equal(deploymentEnvironment(), "development")
})

test("a preview build is not production, despite NODE_ENV saying so", () => {
  // Vercel compiles previews with NODE_ENV=production; this is the distinction
  // the codebase could not previously make.
  setEnv({ VERCEL_ENV: "preview", NODE_ENV: "production" })
  assert.equal(isProductionDeployment(), false)
})

test("off Vercel the environment falls back to NODE_ENV", () => {
  setEnv({ VERCEL_ENV: undefined, NODE_ENV: "production" })
  assert.equal(deploymentEnvironment(), "production")

  setEnv({ VERCEL_ENV: undefined, NODE_ENV: "development" })
  assert.equal(deploymentEnvironment(), "development")
})

test("an unrecognized VERCEL_ENV does not silently become production", () => {
  setEnv({ VERCEL_ENV: "staging", NODE_ENV: "development" })
  assert.equal(deploymentEnvironment(), "development")
})

test("data is assumed to be production unless declared isolated", () => {
  setEnv({ DATA_ENVIRONMENT: undefined })
  assert.equal(isWiredToProductionData(), true)

  setEnv({ DATA_ENVIRONMENT: "production" })
  assert.equal(isWiredToProductionData(), true)

  setEnv({ DATA_ENVIRONMENT: "isolated" })
  assert.equal(isWiredToProductionData(), false)

  setEnv({ DATA_ENVIRONMENT: "  ISOLATED  " })
  assert.equal(isWiredToProductionData(), false)
})

test("a preview pointed at production data cannot perform a destructive write", () => {
  setEnv({ VERCEL_ENV: "preview", NODE_ENV: "production", DATA_ENVIRONMENT: undefined })
  assert.throws(
    () => assertSafeToMutateProductionData("delete a research report"),
    (err: unknown) => {
      assert.ok(err instanceof ProductionDataWriteError)
      assert.match(err.message, /Refusing to delete a research report/)
      assert.match(err.message, /DATA_ENVIRONMENT=isolated/)
      return true
    }
  )
})

test("a preview with its own stores is allowed to delete", () => {
  // Otherwise the dev environment could not exercise the feature it is for.
  setEnv({ VERCEL_ENV: "preview", NODE_ENV: "production", DATA_ENVIRONMENT: "isolated" })
  assert.doesNotThrow(() => assertSafeToMutateProductionData("delete a research report"))
})

test("production is always allowed to write its own data", () => {
  setEnv({ VERCEL_ENV: "production", NODE_ENV: "production", DATA_ENVIRONMENT: undefined })
  assert.doesNotThrow(() => assertSafeToMutateProductionData("delete a research report"))
})

test("local development against production data is blocked", () => {
  // The realistic version of this: a .env.local holding production credentials.
  setEnv({ VERCEL_ENV: undefined, NODE_ENV: "development", DATA_ENVIRONMENT: undefined })
  assert.throws(
    () => assertSafeToMutateProductionData("bulk-delete reports"),
    ProductionDataWriteError
  )
})
