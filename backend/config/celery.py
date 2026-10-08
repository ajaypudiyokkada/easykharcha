import os

from celery import Celery
from celery.schedules import crontab

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings.dev")

app = Celery("easykharcha")
app.config_from_object("django.conf:settings", namespace="CELERY")
app.autodiscover_tasks()


@app.on_after_finalize.connect
def setup_periodic_tasks(sender, **kwargs):
    """Sweep every hour on the hour.

    Each tenant has its own `sla_hours`, so a single fixed schedule can't be right for everyone; the task
    re-evaluates each tenant's deadline itself and only notifies on transitions.
    """
    from django.conf import settings

    sender.add_periodic_task(
        crontab(minute=settings.SLA_SWEEP_MINUTE),
        sweep_sla.s(),
        name="hourly SLA sweep",
    )


@app.task(name="config.sweep_sla")
def sweep_sla():
    from reports.tasks import sweep_all_tenants

    return sweep_all_tenants()
