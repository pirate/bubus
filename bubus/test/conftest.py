import logging
import os

import pytest


@pytest.fixture(autouse=True)
def set_log_level():
    os.environ['BUBUS_LOG_LEVEL'] = 'DEBUG'
    import bubus.models
    import bubus.service

    bubus.service.logger.setLevel(logging.DEBUG)
    bubus.models.logger.setLevel(logging.DEBUG)
