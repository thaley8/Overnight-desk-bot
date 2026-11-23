"""deskview: read-only HTTP/WebSocket view of the Overnight Desk.

Never writes under the desk root, never talks to the desk Chrome/CDP or the FOMO API,
never returns secret values. See README.md for the full never-list.
"""

__version__ = "0.1.0"
