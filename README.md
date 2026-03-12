# Kate's Photo Journal

Automated weekly photo journal using Google Apps Script, Google Drive, and Blogger.

## Overview

This project automatically creates weekly blog posts from photos synced to Google Drive via FolderSync Pro. It includes:

- **Photo collection**: Fetches images from Google Drive folder
- **AI annotation**: Uses Claude API to generate captions for screenshots/photos  
- **Blog generation**: Creates Blogger draft posts with images and captions
- **Email notification**: Sends review link to kate@yoak.com

## Files

- `Code.gs` - Main Apps Script code
- `appsscript.json` - Apps Script manifest and OAuth scopes
- `Code.js` - Apps Script format (auto-generated from Code.gs)
- `blogger-theme.xml` - Current Blogger theme for customization

## Setup

1. **Apps Script Project**: Deploy via `clasp push`
2. **API Keys**: Set `CLAUDE_API_KEY` in Script Properties
3. **Scopes**: Blogger, Gmail, Drive, Script permissions
4. **Trigger**: Run `createWeeklyTrigger()` for Monday 9am automation

## Usage

- `annotateImages()` - Process photos with Claude API captions
- `createWeeklyJournalDraft()` - Generate weekly blog post
- `setupAnnotation()` - Initialize annotation system

## Architecture

- **Photos**: FolderSync Pro → Google Drive → Apps Script
- **Captions**: Claude API via Apps Script → Drive file metadata
- **Blog**: Apps Script → Blogger API → Draft post + email notification