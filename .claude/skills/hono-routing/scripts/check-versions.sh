#!/bin/bash

# Hono Skill - Package Version Checker
# Verifies that all package versions are current

echo "🔍 Checking Hono skill package versions..."
echo ""

# Color codes
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Counter for outdated packages
OUTDATED=0

# Function to check package version
check_package() {
    local package=$1
    local current_version=$2

    echo -n "Checking $package... "

    # Get latest version from npm
    latest=$(npm view "$package" version 2>/dev/null)

    if [ $? -ne 0 ]; then
        echo -e "${RED}ERROR${NC} (package not found)"
        return 1
    fi

    if [ "$current_version" == "$latest" ]; then
        echo -e "${GREEN}✓${NC} $current_version (latest)"
    else
        echo -e "${YELLOW}⚠${NC} $current_version → $latest (update available)"
        ((OUTDATED++))
    fi
}

echo "Core Dependencies:"
echo "─────────────────"
check_package "hono" "4.12.12"
echo ""

echo "Validation Libraries:"
echo "────────────────────"
check_package "zod" "4.3.6"
check_package "valibot" "1.1.0"
echo ""

echo "Hono Validators:"
echo "───────────────"
check_package "@hono/zod-validator" "0.7.4"
check_package "@hono/valibot-validator" "0.6.1"
check_package "@hono/typia-validator" "0.1.2"
check_package "@hono/arktype-validator" "2.0.1"
echo ""

echo "Summary:"
echo "────────"
if [ $OUTDATED -eq 0 ]; then
    echo -e "${GREEN}✓${NC} All packages are up to date!"
else
    echo -e "${YELLOW}⚠${NC} $OUTDATED package(s) have updates available"
    echo ""
    echo "To update, run:"
    echo "  npm install hono@latest"
    echo "  npm install zod@latest valibot@latest"
    echo "  npm install @hono/zod-validator@latest @hono/valibot-validator@latest"
fi

echo ""
echo "Last checked: $(date)"
