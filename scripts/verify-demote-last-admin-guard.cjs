const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');
const { Worker, isMainThread, parentPort, workerData } = require('node:worker_threads');
const ts = require('typescript');

const repoRoot = path.resolve(__dirname, '..');
const originalResolveFilename = Module._resolveFilename;
const originalLoad = Module._load;

require.extensions['.ts'] = (module, filename) => {
  const source = fs.readFileSync(filename, 'utf8');
  const output = ts.transpileModule(source, {
    compilerOptions: {
      esModuleInterop: true,
      module: ts.ModuleKind.CommonJS,
      moduleResolution: ts.ModuleResolutionKind.NodeJs,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: filename,
  }).outputText;
  module._compile(output, filename);
};

Module._resolveFilename = function resolveFilename(request, parent, isMain, options) {
  if (request.startsWith('@/')) {
    return originalResolveFilename.call(
      this,
      path.join(repoRoot, 'src', request.slice(2)),
      parent,
      isMain,
      options,
    );
  }
  return originalResolveFilename.call(this, request, parent, isMain, options);
};

Module._load = function load(request, parent, isMain) {
  if (request === 'next/headers') {
    return {
      cookies: async () => ({ get: () => undefined, set: () => undefined }),
      headers: async () => ({ get: () => undefined }),
    };
  }
  if (request === 'next/server') {
    return {
      NextResponse: {
        json: (body, init) => ({ body, init }),
      },
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};

process.env.SESSION_SECRET = 'test-session-secret-with-at-least-32-characters';

function sleepMs(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function registerSlowDemoteTrigger(db) {
  db.function('sleep_ms', { deterministic: false }, sleepMs);
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS slow_admin_demote
    BEFORE UPDATE OF is_admin ON users
    WHEN OLD.is_admin = 1 AND NEW.is_admin = 0
    BEGIN
      SELECT sleep_ms(250);
    END;
  `);
}

if (!isMainThread) {
  const started = new Int32Array(workerData.startSignal);

  const { demoteUser, RoleError } = require(path.join(repoRoot, 'src/lib/auth.ts'));
  const { getDb } = require(path.join(repoRoot, 'src/lib/db.ts'));

  registerSlowDemoteTrigger(getDb());
  parentPort.postMessage({ type: 'ready', id: workerData.id });
  Atomics.wait(started, 0, 0);

  try {
    const user = demoteUser(workerData.id, 999);
    parentPort.postMessage({ type: 'result', id: workerData.id, ok: true, isAdmin: user.is_admin });
  } catch (error) {
    parentPort.postMessage({
      type: 'result',
      id: workerData.id,
      ok: false,
      isRoleError: error instanceof RoleError,
      code: error && error.code,
      message: error && error.message,
    });
  }
  process.exit(0);
}

async function runCompetingDemotions() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gittensor-auth-'));
  process.chdir(tempRoot);

  const { countAdmins } = require(path.join(repoRoot, 'src/lib/auth.ts'));
  const { getDb } = require(path.join(repoRoot, 'src/lib/db.ts'));

  const db = getDb();
  registerSlowDemoteTrigger(db);

  const now = new Date().toISOString();
  const insertUser = db.prepare(
    `INSERT INTO users (
       github_id, github_login, avatar_url, status, is_admin,
       created_at, last_login_at, approved_at, approved_by_id
     ) VALUES (?, ?, NULL, 'approved', ?, ?, ?, ?, NULL)`,
  );

  insertUser.run('1', 'admin-a', 1, now, now, now);
  insertUser.run('2', 'admin-b', 1, now, now, now);

  const startSignal = new SharedArrayBuffer(4);
  const started = new Int32Array(startSignal);

  const workers = [1, 2].map((id) => new Worker(__filename, {
    workerData: { id, startSignal },
  }));

  const ready = [];
  const results = [];

  await new Promise((resolve, reject) => {
    for (const worker of workers) {
      worker.on('message', (message) => {
        if (message.type === 'ready') {
          ready.push(message.id);
          if (ready.length === workers.length) {
            Atomics.store(started, 0, 1);
            Atomics.notify(started, 0, workers.length);
          }
          return;
        }

        if (message.type === 'result') {
          results.push(message);
          if (results.length === workers.length) resolve();
        }
      });
      worker.on('error', reject);
      worker.on('exit', (code) => {
        if (code !== 0) reject(new Error(`worker exited with code ${code}`));
      });
    }
  });

  await Promise.all(workers.map((worker) => worker.terminate()));

  assert.deepEqual(ready.sort(), [1, 2], 'both workers should be ready before demotions start');
  assert.equal(countAdmins(), 1, 'exactly one admin must remain after competing demotions');
  assert.equal(results.filter((result) => result.ok).length, 1, 'one demotion should succeed');

  const failures = results.filter((result) => !result.ok);
  assert.equal(failures.length, 1, 'one demotion should fail');
  assert.equal(failures[0].isRoleError, true, 'failure should be a RoleError');
  assert.equal(failures[0].code, 'last_admin', 'failure should reject the last admin demotion');
}

runCompetingDemotions()
  .then(() => {
    console.log('demoteUser concurrent last-admin guard verified');
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
