'use strict';

/**
 * mira-planner.js
 *
 * The planning layer — elevates MIRA from reactive script-runner to goal-driven agent.
 *
 * Architecture:
 *   Goal arrives (user/mail/schedule)
 *     → _generatePlan()     asks backend to build ordered route-list via Claude
 *     → _executeGoal()      runs steps one-by-one, waits for each to finish
 *     → remember()          writes outcome to working memory after every step
 *     → _replan()           on step failure: Claude tries a different path
 *     → escalate / done     notify UI, write final memory entry
 *
 * Working memory gives MIRA continuity across sessions:
 *   "Yesterday Müller GmbH sent an invoice → today the reminder arrived"
 *   — that connection only exists because it was remembered.
 *
 * Dependencies injected at init() to avoid circular deps with main.js:
 *   executeRoute(routeId, ctx)  — run a route by ID, returns when done
 *   notify(type, payload)       — send IPC to renderer
 */

const fetch = require('node-fetch');

const GOAL_POLL_MS = 12_000; // check for new goals every 12s

class MiraPlanner {
  constructor() {
    this._api          = null;
    this._token        = null;
    this._deviceId     = null;
    this._executeRoute = null;
    this._notify       = null;
    this._activeGoals  = new Map();   // goalId → { step, total }
    this._timer        = null;
    this._inited       = false;
  }

  // ── Setup ─────────────────────────────────────────────────────────────────

  init({ api, token, deviceId, executeRoute, notify }) {
    this._api          = api;
    this._token        = token;
    this._deviceId     = deviceId;
    this._executeRoute = executeRoute;
    this._notify       = notify;
    this._inited       = true;
  }

  async start() {
    if (!this._inited) return;
    await this._tick();
    this._timer = setInterval(() => this._tick(), GOAL_POLL_MS);
    console.log('🎯 MiraPlanner: gestartet');
  }

  stop() {
    if (this._timer) { clearInterval(this._timer); this._timer = null; }
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  /**
   * Submit a new goal. Returns the goal_id.
   * Goal = desired end-state in natural language.
   *   e.g. "Alle Oktober-Rechnungen sind bis Freitag gebucht"
   */
  async submitGoal(goalText, context = {}, deadline = null) {
    if (!this._inited) throw new Error('MiraPlanner not initialized');
    const res  = await fetch(`${this._api}/api/brain/goals`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ token: this._token, goal: goalText, context, deadline }),
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error || 'Goal creation failed');
    console.log(`🎯 Ziel eingereicht: "${goalText}" → ${data.goal_id}`);
    return data.goal_id;
  }

  /**
   * Write an event or fact to working memory.
   * Called automatically by the planner after every step.
   * Can also be called from anywhere in main.js for important events.
   */
  async remember(type, subject, content, tags = [], goalId = null) {
    if (!this._inited) return;
    try {
      await fetch(`${this._api}/api/brain/memory`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          token: this._token, type, subject, content, tags,
          goal_id: goalId || null,
        }),
      });
    } catch (e) {
      console.warn(`🧠 Memory write failed: ${e.message}`);
    }
  }

  /**
   * Search working memory for entries matching a query.
   * Used by _generatePlan to give Claude context about past events.
   */
  async recall(query, limit = 6) {
    if (!this._inited) return [];
    try {
      const res  = await fetch(`${this._api}/api/brain/memory?token=${this._token}&q=${encodeURIComponent(query)}&limit=${limit}`);
      const data = await res.json();
      return data.entries || [];
    } catch (e) {
      return [];
    }
  }

  // ── Private: Goal polling ─────────────────────────────────────────────────

  async _tick() {
    if (!this._inited) return;
    try {
      const res  = await fetch(`${this._api}/api/brain/goals?token=${this._token}&status=pending`);
      const data = await res.json();
      if (!data.success || !data.goals?.length) return;

      for (const goal of data.goals) {
        if (this._activeGoals.has(goal.id)) continue;
        // Fire-and-forget with tracking — don't await so multiple goals can run
        this._runGoal(goal).catch(e => {
          console.error(`🎯 Unhandled goal error [${goal.id}]:`, e.message);
          this._activeGoals.delete(goal.id);
        });
      }
    } catch (e) {
      console.warn(`🎯 Planner tick error: ${e.message}`);
    }
  }

  // ── Private: Goal execution ───────────────────────────────────────────────

  async _runGoal(goal) {
    this._activeGoals.set(goal.id, { step: 0, total: 0 });
    console.log(`🎯 Starte Ziel: "${goal.goal}"`);
    this._emit('goal-started', { goal: goal.goal, goal_id: goal.id });

    try {
      // Mark as planning
      await this._patchGoal(goal.id, { status: 'planning' });

      // Generate plan
      let plan = goal.plan;
      if (!plan?.steps?.length) {
        plan = await this._generatePlan(goal);
        if (!plan?.steps?.length) {
          await this._patchGoal(goal.id, { status: 'failed', result: 'Kein Plan generierbar' });
          this._emit('goal-failed', { goal: goal.goal, reason: 'Kein Plan generierbar' });
          return;
        }
      }

      const steps = plan.steps;
      await this._patchGoal(goal.id, { status: 'executing', plan, steps_total: steps.length });
      this._activeGoals.get(goal.id).total = steps.length;

      // Execute steps
      for (let i = 0; i < steps.length; i++) {
        const step = steps[i];
        this._activeGoals.get(goal.id).step = i + 1;

        console.log(`🎯 Step ${i + 1}/${steps.length}: ${step.description}`);
        this._emit('goal-step', {
          goal: goal.goal, goal_id: goal.id,
          step: i + 1, total: steps.length,
          description: step.description,
        });

        let stepOk = false;
        try {
          await this._executeRoute(step.route_id, { goalId: goal.id, stepIndex: i });
          stepOk = true;
          await this.remember('event', goal.goal,
            `Step ${i + 1} ✓: ${step.description}`, ['goal', 'step_ok'], goal.id);
          await this._patchGoal(goal.id, { steps_done: i + 1 });
        } catch (stepErr) {
          console.warn(`🎯 Step ${i + 1} fehlgeschlagen: ${stepErr.message}`);
          await this.remember('event', goal.goal,
            `Step ${i + 1} ✗: ${step.description} — ${stepErr.message}`, ['goal', 'step_fail'], goal.id);

          // Try to replan from current position
          const newPlan = await this._replan(goal, plan, i, stepErr.message);
          if (newPlan?.steps?.length) {
            console.log(`🎯 Replan erfolgreich: ${newPlan.steps.length} neue Steps`);
            plan   = newPlan;
            // splice: replace remaining steps with replan
            steps.splice(i, steps.length - i, ...newPlan.steps);
            await this._patchGoal(goal.id, { plan, steps_total: steps.length });
            i--; // retry from same position with new step
            continue;
          }

          // Replan failed → escalate
          await this._patchGoal(goal.id, { status: 'failed', result: `Fehlgeschlagen: ${stepErr.message}` });
          this._emit('goal-failed', { goal: goal.goal, goal_id: goal.id, reason: stepErr.message, step: i + 1 });
          return;
        }
      }

      // All steps done
      await this._patchGoal(goal.id, { status: 'done', result: 'Alle Steps abgeschlossen' });
      await this.remember('fact', goal.goal,
        `Ziel abgeschlossen: "${goal.goal}"`, ['goal', 'done'], goal.id);
      console.log(`🎯 ✅ Ziel abgeschlossen: "${goal.goal}"`);
      this._emit('goal-done', { goal: goal.goal, goal_id: goal.id, steps: steps.length });

    } catch (e) {
      console.error(`🎯 Ziel crashed: ${e.message}`);
      await this._patchGoal(goal.id, { status: 'failed', result: e.message }).catch(() => {});
      this._emit('goal-failed', { goal: goal.goal, reason: e.message });
    } finally {
      this._activeGoals.delete(goal.id);
    }
  }

  // ── Private: Planning ─────────────────────────────────────────────────────

  async _generatePlan(goal, opts = {}) {
    try {
      const memory = await this.recall(goal.goal, 6);
      const res    = await fetch(`${this._api}/api/brain/plan`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          token:       this._token,
          goal:        goal.goal,
          context:     goal.context || {},
          memory,
          replan:      opts.replan    || false,
          failed_plan: opts.failedPlan || null,
          failed_step: opts.failedStep ?? null,
          error:       opts.error      || null,
        }),
      });
      const data = await res.json();
      if (!data.success || !data.plan?.steps?.length) return null;
      return data.plan;
    } catch (e) {
      console.warn(`🎯 Plan generation failed: ${e.message}`);
      return null;
    }
  }

  async _replan(goal, failedPlan, failedStepIdx, errorMsg) {
    return this._generatePlan(goal, {
      replan:     true,
      failedPlan,
      failedStep: failedStepIdx,
      error:      errorMsg,
    });
  }

  // ── Private: Helpers ──────────────────────────────────────────────────────

  async _patchGoal(goalId, fields) {
    try {
      await fetch(`${this._api}/api/brain/goals/${goalId}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ token: this._token, ...fields }),
      });
    } catch (e) {
      console.warn(`🎯 patchGoal failed: ${e.message}`);
    }
  }

  _emit(type, payload) {
    if (this._notify) this._notify(type, payload);
  }
}

module.exports = new MiraPlanner();
