begin;

-- Keep identifier lookups bounded by their requested time range.
-- 标识符检索必须与时间范围联合，避免日志工作台扫描整张事件表。
create index if not exists observability_log_events_request_occurred_idx
  on observability_log_events(request_id, occurred_at desc, id desc);

-- Filter the durable log stream by its structured UI dimensions.
-- 日志流按结构化工作台维度筛选；不为 payload 或 search_text 建索引。
create index if not exists observability_log_events_service_event_occurred_idx
  on observability_log_events(service, event_name, occurred_at desc, id desc);
create index if not exists observability_log_events_event_occurred_idx
  on observability_log_events(event_name, occurred_at desc, id desc);
create index if not exists observability_log_events_route_occurred_idx
  on observability_log_events(route, occurred_at desc, id desc);
create index if not exists observability_log_events_http_status_occurred_idx
  on observability_log_events(http_status, occurred_at desc, id desc);
create index if not exists observability_log_events_duration_occurred_idx
  on observability_log_events(duration_ms, occurred_at desc, id desc);

-- Error events are a separate stream in the unified log query and need the
-- same correlation filters. severity is exposed as level by that query.
-- 错误事件是统一日志查询的独立数据流，同样需要关联筛选；查询层将 severity 映射为 level。
create index if not exists observability_error_events_trace_occurred_idx
  on observability_error_events(trace_id, occurred_at desc, id desc);
create index if not exists observability_error_events_request_occurred_idx
  on observability_error_events(request_id, occurred_at desc, id desc);
create index if not exists observability_error_events_task_occurred_idx
  on observability_error_events(task_id, occurred_at desc, id desc);
create index if not exists observability_error_events_service_occurred_idx
  on observability_error_events(service, occurred_at desc, id desc);
create index if not exists observability_error_events_route_occurred_idx
  on observability_error_events(route, occurred_at desc, id desc);
create index if not exists observability_error_events_http_status_occurred_idx
  on observability_error_events(http_status, occurred_at desc, id desc);
create index if not exists observability_error_events_source_severity_occurred_idx
  on observability_error_events(source, severity, occurred_at desc, id desc);

commit;
