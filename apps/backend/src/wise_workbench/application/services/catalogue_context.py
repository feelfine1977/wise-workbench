"""Curated public-log context, paraphrased from publisher/organizer sources.

Filename aliases are descriptive hints, never a verification of local file provenance.
Unknown filenames have no public context. No network or event-log reads occur here.
"""

from pathlib import Path

from pydantic import BaseModel


class CatalogueSource(BaseModel):
    title: str
    url: str


class CatalogueContext(BaseModel):
    title: str
    processDescription: str
    challengeDescription: str | None = None
    sources: list[CatalogueSource]


def context(title: str, process: str, challenge: str | None, url: str) -> CatalogueContext:
    return CatalogueContext(
        title=title,
        processDescription=process,
        challengeDescription=challenge,
        sources=[CatalogueSource(title="Official challenge" if challenge else "Dataset publisher", url=url)],
    )


PUBLIC_LOGS = {
    "hospital_log": context(
        "BPI Challenge 2011 · Hospital",
        "Patient pathways in the gynaecology department of a Dutch academic hospital, with activities and performing groups.",
        "An open analysis challenge: investigate the real hospital log and document useful insights. No specific bottleneck is asserted here.",
        "https://ais.win.tue.nl/bpi/2011/challenge.html",
    ),
    "bpi_challenge_2012": context(
        "BPI Challenge 2012 · Loan applications",
        "Loan application processing at a Dutch financial institution.",
        "An open analysis challenge: analyze the supplied event log and report insights into the process.",
        "https://ais.win.tue.nl/bpi/2012/challenge.html",
    ),
    "bpi_challenge_2013_incidents": context(
        "BPI Challenge 2013 · Incidents",
        "IT incident handling at Volvo IT Belgium, recorded in the VINST incident and problem management system.",
        "Investigate premature escalation, repeated transfers between teams, use of the wait-user status, and differences between the two IT organizations.",
        "https://ais.win.tue.nl/bpi/2013/challenge.html",
    ),
    "bpi_challenge_2017": context(
        "BPI Challenge 2017 · Loan applications",
        "Dutch financial institution loan applications, including application states, multiple offers per application, and workflow events.",
        "Separate internal waiting from waiting for applicants; examine incomplete applications and acceptance, and compare conversion for single versus multiple offers.",
        "https://ais.win.tue.nl/bpi/2017/challenge.html",
    ),
    "bpi_challenge_2018": context(
        "BPI Challenge 2018 · Agricultural payments",
        "Annual applications for EU agricultural payments to German farmers, including supporting documents, inspections and payment authorization.",
        "Predict late payments or reopened cases, improve inspection selection for severe penalties, and explain differences between departments and years. Predictors must precede the relevant decision or inspection.",
        "https://ais.win.tue.nl/bpi/2018/challenge.html",
    ),
    "bpi_challenge_2019": context(
        "BPI Challenge 2019 · Purchasing",
        "Purchase-order handling at a multinational coatings and paints company, across subsidiaries.",
        "Describe the different purchase-item flows, match receipts and invoices to measure throughput, and identify process or value deviations and rework.",
        "https://www.tf-pm.org/competitions-awards/bpi-challenge/2019",
    ),
    "finale": context(
        "Helpdesk",
        "Helpdesk ticket management in a software company, from recording a ticket through resolution and closure.",
        None,
        "https://data.mendeley.com/datasets/39bp3vv62t/1",
    ),
    "hospital_billing_event_log": context(
        "Hospital Billing",
        "Billing of bundled medical services in a hospital ERP system. These are billing activities, not the clinical care itself.",
        None,
        "https://www.tf-pm.org/resources/xes-standard/about-xes/event-logs",
    ),
    "road_traffic_fine_management_process": context(
        "Road traffic fines",
        "Events from an information system that manages road traffic fines.",
        None,
        "https://research.tue.nl/en/datasets/road-traffic-fine-management-process/",
    ),
    "sepsis_cases_event_log": context(
        "Sepsis cases",
        "Hospital pathways for sepsis cases, with activities, laboratory results and checklist attributes. Published timestamps were randomized while intervals within each case were retained.",
        None,
        "https://research.tue.nl/en/datasets/sepsis-cases-event-log/",
    ),
}

for municipality in range(1, 6):
    PUBLIC_LOGS[f"bpic15_{municipality}"] = context(
        f"BPI Challenge 2015 · Municipality {municipality}",
        f"Building-permit applications and objections in municipality {municipality}, one of five Dutch municipalities.",
        "Compare roles, organizational structures, throughput and control flow; investigate co-location and proposed outsourcing.",
        "https://research.tue.nl/nl/publications/bpi-challenge-2015/",
    )

for stem, subject in {
    "detail_incident": "Incident records",
    "detail_change": "Change records",
    "detail_incident_activity": "Incident activity events",
    "detail_interaction": "Service-desk interaction records",
}.items():
    PUBLIC_LOGS[stem] = context(
        f"BPI Challenge 2014 · {subject}",
        f"{subject} from Rabobank Group ICT's IT service management system. The case tables and incident activity log are separate extracts.",
        "Predict service-desk and IT-operations workload after software changes to support release planning.",
        "https://research.tue.nl/en/publications/bpi-challenge-2014/",
    )

for stem, subject in {
    "prepaidtravelcost": "Reimbursement of prepaid travel expenses at TU/e.",
    "permitlog": "TU/e travel permits, including related declarations and prepaid expenses.",
    "internationaldeclarations": "International travel expense declarations at TU/e.",
    "domesticdeclarations": "Domestic travel expense declarations at TU/e.",
    "requestforpayment": "TU/e payment requests for expenses that should not be travel-related.",
}.items():
    PUBLIC_LOGS[stem] = context(
        "BPI Challenge 2020",
        subject,
        "Study reimbursement throughput, approval bottlenecks, rejections and corrections; check duplicate payments and required permits. Questions span the related logs.",
        "https://www.tf-pm.org/competitions-awards/bpi-challenge/2020",
    )


def public_log_context(filename: str) -> CatalogueContext | None:
    """Match exact known basenames after removing supported format suffixes."""
    import re

    name = Path(filename).name.lower()
    for suffix in (".xes.gz", ".xes", ".csv", ".parquet"):
        if name.endswith(suffix):
            name = name[: -len(suffix)]
            break
    key = re.sub(r"[\s_-]+", "_", name)
    return PUBLIC_LOGS.get(key)
