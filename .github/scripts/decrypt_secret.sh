#!/bin/sh

# Decrypt the testWallets.json file for tests

pwd

ls

gpg --quiet --batch --yes --decrypt --passphrase="$SECRET_PASSPHRASE_FOR_TESTS" \
--output ./tests/testWallets.json ./tests/testWallets.json.gpp