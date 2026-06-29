"""Idempotent startup seeding of built-in formulas (feature 063).

The default value+quality fundamentals formula is registered here rather than via the
RegisterFormula RPC because that RPC mints a random id per call and there is no
name-uniqueness constraint — a naive re-register would duplicate rows on every restart.
Seeding with a deterministic well-known id + an upsert keeps it restart-safe and gives
Feature 062 a stable scoring_formula_id to reference.
"""

import logging

from google.protobuf.json_format import MessageToDict

from app.formulas import fundamentals_value_quality as fvq
from app.services import parameters as params_validation
from app.services.formulas_repository import FormulasRepository

log = logging.getLogger(__name__)


async def seed_default_formulas(db_pool) -> None:
    """Upsert the built-in formulas. Never raises — seeding must not block startup."""
    if db_pool is None:
        log.warning("seed_default_formulas: no db pool; skipping formula seeding")
        return
    try:
        # Validate with the same gate RegisterFormula applies, so a malformed seed fails
        # fast (logged) rather than at first execute.
        params_validation.validate_definitions(fvq.PARAMETERS)
        params_validation.validate_outputs(fvq.OUTPUTS)

        param_dicts = [MessageToDict(p) for p in fvq.PARAMETERS]
        output_dicts = [MessageToDict(o) for o in fvq.OUTPUTS]

        await FormulasRepository(db_pool).upsert(
            formula_id=fvq.FORMULA_ID,
            name=fvq.NAME,
            description=fvq.DESCRIPTION,
            source=fvq.SOURCE,
            author=fvq.AUTHOR,
            is_public=fvq.IS_PUBLIC,
            input_schema={},
            parameters=param_dicts,
            outputs=output_dicts,
        )
        log.info("seeded default formula %s (%s)", fvq.NAME, fvq.FORMULA_ID)
    except Exception as e:  # noqa: BLE001 - seeding must never prevent startup
        log.warning("seed_default_formulas failed (non-fatal): %s", e)
