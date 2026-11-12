import { defineExportSuite } from './instrumentation.testkit';

// The temporality env is read when the exporter is constructed, so it is set before register() runs.
process.env.OTEL_EXPORTER_OTLP_METRICS_TEMPORALITY_PREFERENCE = 'delta';
defineExportSuite('Authorization=Basic dGVzdDprZXk=', { delta: true });
