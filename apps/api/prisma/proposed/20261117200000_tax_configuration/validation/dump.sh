#!/bin/bash
# Schema-only dump without pg_dump's random \restrict tokens.
cd /tmp && sudo -u postgres pg_dump -s -d "$1" | grep -v '^\\\(un\)\?restrict '
