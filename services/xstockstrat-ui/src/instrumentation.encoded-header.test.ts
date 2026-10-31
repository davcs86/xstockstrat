import { defineExportSuite } from './instrumentation.testkit';

// Percent-encoded header form (the OTEL_EXPORTER_OTLP_HEADERS spec encoding).
defineExportSuite('Authorization=Basic%20dGVzdDprZXk%3D');
