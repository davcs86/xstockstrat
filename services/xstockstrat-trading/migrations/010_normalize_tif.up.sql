-- Normalize historical time_in_force strings to lowercase canonical forms.
-- Column stays TEXT — the Go layer owns validation (same pattern as order_type).
UPDATE trading.orders SET time_in_force = LOWER(time_in_force)
WHERE time_in_force IS DISTINCT FROM LOWER(time_in_force);

UPDATE trading.orders SET time_in_force = 'gtc'
WHERE time_in_force IN ('good_till_cancel', 'good_til_cancel', 'good_till_cancelled');

UPDATE trading.orders SET time_in_force = 'day'
WHERE time_in_force IS NULL OR time_in_force = '';
