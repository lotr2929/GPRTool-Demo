@echo off
title MCP Filesystem - GPRTool

REM ================================
REM MCP Filesystem Server for GPRTool
REM ================================

echo Starting MCP filesystem server...
echo Allowed root:
echo   C:\Users\263350F\_myProjects\GPRTool
echo Mode: READ / WRITE
echo.

REM Use npx to avoid global install issues
npx @modelcontextprotocol/server-filesystem ^
  "C:\Users\263350F\_myProjects\GPRTool"

echo.
echo MCP filesystem server stopped.
pause