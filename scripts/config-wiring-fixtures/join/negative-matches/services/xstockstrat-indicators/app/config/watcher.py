class ConfigWatcher:
    def sandbox_timeout_ms(self):
        return self.get_int("indicators.sandbox.timeout_ms", 5000)
