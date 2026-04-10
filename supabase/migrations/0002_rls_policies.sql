-- Enable RLS on all tables
ALTER TABLE "alert_rule" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "alert_event" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "pipeline_item" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "watchlist" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "watchlist_entity" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "hidden_entity" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "entity" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "raw_observation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "metric_timeseries" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "score_snapshot" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "source_run" ENABLE ROW LEVEL SECURITY;

-- alert_rule: users see/manage only their own rules
CREATE POLICY "alert_rule_select" ON "alert_rule" FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "alert_rule_insert" ON "alert_rule" FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "alert_rule_update" ON "alert_rule" FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "alert_rule_delete" ON "alert_rule" FOR DELETE USING (auth.uid() = user_id);

-- alert_event: users see events belonging to their own alert rules
CREATE POLICY "alert_event_select" ON "alert_event" FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM "alert_rule"
    WHERE "alert_rule"."id" = "alert_event"."rule_id"
    AND "alert_rule"."user_id" = auth.uid()
  ));

-- pipeline_item: users see/manage only their own pipeline items
CREATE POLICY "pipeline_item_select" ON "pipeline_item" FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "pipeline_item_insert" ON "pipeline_item" FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "pipeline_item_update" ON "pipeline_item" FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "pipeline_item_delete" ON "pipeline_item" FOR DELETE USING (auth.uid() = user_id);

-- watchlist: users see/manage only their own watchlists
CREATE POLICY "watchlist_select" ON "watchlist" FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "watchlist_insert" ON "watchlist" FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "watchlist_update" ON "watchlist" FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "watchlist_delete" ON "watchlist" FOR DELETE USING (auth.uid() = user_id);

-- watchlist_entity: users manage entries for their own watchlists
CREATE POLICY "watchlist_entity_select" ON "watchlist_entity" FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM "watchlist"
    WHERE "watchlist"."id" = "watchlist_entity"."watchlist_id"
    AND "watchlist"."user_id" = auth.uid()
  ));
CREATE POLICY "watchlist_entity_insert" ON "watchlist_entity" FOR INSERT
  WITH CHECK (EXISTS (
    SELECT 1 FROM "watchlist"
    WHERE "watchlist"."id" = "watchlist_entity"."watchlist_id"
    AND "watchlist"."user_id" = auth.uid()
  ));
CREATE POLICY "watchlist_entity_delete" ON "watchlist_entity" FOR DELETE
  USING (EXISTS (
    SELECT 1 FROM "watchlist"
    WHERE "watchlist"."id" = "watchlist_entity"."watchlist_id"
    AND "watchlist"."user_id" = auth.uid()
  ));

-- hidden_entity: users see/manage only their own hidden entries
CREATE POLICY "hidden_entity_select" ON "hidden_entity" FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "hidden_entity_insert" ON "hidden_entity" FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "hidden_entity_delete" ON "hidden_entity" FOR DELETE USING (auth.uid() = user_id);

-- Shared market-data tables: any authenticated user can read.
-- Cron jobs use the service role key, which bypasses RLS automatically.
CREATE POLICY "entity_select" ON "entity" FOR SELECT TO authenticated USING (true);
CREATE POLICY "raw_observation_select" ON "raw_observation" FOR SELECT TO authenticated USING (true);
CREATE POLICY "metric_timeseries_select" ON "metric_timeseries" FOR SELECT TO authenticated USING (true);
CREATE POLICY "score_snapshot_select" ON "score_snapshot" FOR SELECT TO authenticated USING (true);
CREATE POLICY "source_run_select" ON "source_run" FOR SELECT TO authenticated USING (true);
