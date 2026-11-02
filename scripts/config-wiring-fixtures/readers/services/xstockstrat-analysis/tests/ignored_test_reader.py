def test_reader(cfg):
    assert cfg.get_str("analysis.should_not_be_scanned", "") == ""
