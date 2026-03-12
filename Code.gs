// ============================================================
// KATE'S PHOTO JOURNAL — Google Apps Script Automation
// ============================================================
// Photos are fetched from Google Drive (synced from Google Photos).
// Images are made publicly accessible and served directly from Drive.
// ============================================================

// ── CONSTANTS ───────────────────────────────────────────────
var BLOG_ID            = '6171160289292513153';
var NOTIFICATION_EMAIL = 'kate@yoak.com';

var DRIVE_FOLDER_ID    = '1yDlygL7EDx1_JdyIJLS4dVn8W2F9Y0D1';
var DRIVE_FILES_URL    = 'https://www.googleapis.com/drive/v3/files';
var BLOGGER_POSTS_URL  = 'https://www.googleapis.com/blogger/v3/blogs/' + BLOG_ID + '/posts';

// ============================================================
// IMAGE ANNOTATION
// ============================================================

/**
 * Annotates images in the Drive folder using Claude API.
 * Reads prompt from a file in the Apps Script project.
 */
function annotateImages() {
  Logger.log('Starting image annotation...');
  
  // Read the prompt from a file
  var prompt = getAnnotationPrompt();
  if (!prompt) {
    throw new Error('No annotation prompt found. Create a file called "annotation_prompt.txt" in the Apps Script editor.');
  }
  
  // Get Claude API key from script properties
  var apiKey = PropertiesService.getScriptProperties().getProperty('CLAUDE_API_KEY');
  if (!apiKey) {
    throw new Error('Claude API key not found. Set CLAUDE_API_KEY in Script Properties.');
  }
  
  // Get images from Drive folder
  var images = getImagesFromFolder(DRIVE_FOLDER_ID, 5); // Process 5 at a time to stay under execution limits
  Logger.log('Found ' + images.length + ' images to process');
  
  var processed = 0;
  images.forEach(function(image, index) {
    try {
      // Check if already annotated
      var existingCaption = image.properties.ai_caption;
      if (existingCaption) {
        Logger.log('Skipping ' + image.name + ' - already annotated');
        return;
      }
      
      Logger.log('Processing image ' + (index + 1) + ': ' + image.name);
      
      // Get image as base64, resize if needed
      var file = DriveApp.getFileById(image.id);
      var blob = file.getBlob();
      
      // Skip if image is too large (Claude has 5MB limit)
      if (blob.getBytes().length > 4000000) { // 4MB threshold for safety
        Logger.log('Skipping large image: ' + image.name + ' (' + Math.round(blob.getBytes().length/1024/1024*100)/100 + 'MB)');
        return;
      }
      
      var base64 = Utilities.base64Encode(blob.getBytes());
      
      // Call Claude API
      var annotation = callClaudeAPI(apiKey, prompt, base64, image.mimeType);
      
      // Store in file metadata (split if needed)
      storeAnnotationInMetadata(image.id, annotation);
      
      processed++;
      Logger.log('Annotated: ' + annotation.caption);
      
    } catch (e) {
      Logger.log('ERROR processing ' + image.name + ': ' + e.message);
    }
  });
  
  Logger.log('Annotation complete. Processed ' + processed + ' images.');
}

/**
 * Reads the annotation prompt from a file in the Apps Script project.
 */
function getAnnotationPrompt() {
  try {
    // Try to read from a file in the project
    // Note: Apps Script doesn't have direct file access, so we'll store it as a script property for now
    var prompt = PropertiesService.getScriptProperties().getProperty('ANNOTATION_PROMPT');
    
    if (!prompt) {
      // Default prompt if none set
      prompt = "Look at this screenshot and write a brief, natural caption (8-12 words) describing the main activity or content. Focus on what's happening, not technical details.";
      Logger.log('Using default prompt. Set ANNOTATION_PROMPT in Script Properties for custom prompt.');
    }
    
    return prompt;
  } catch (e) {
    Logger.log('Error reading prompt: ' + e.message);
    return null;
  }
}

/**
 * Gets images from a Drive folder that need annotation.
 */
function getImagesFromFolder(folderId, limit) {
  var token = ScriptApp.getOAuthToken();
  var url = DRIVE_FILES_URL +
    '?q=' + encodeURIComponent("'" + folderId + "' in parents and mimeType contains 'image/'") +
    '&fields=files(id,name,mimeType,createdTime,properties)&pageSize=' + (limit || 10) + '&orderBy=createdTime desc';
  
  var response = UrlFetchApp.fetch(url, {
    headers: { Authorization: 'Bearer ' + token },
    muteHttpExceptions: true
  });
  
  var data = JSON.parse(response.getContentText());
  
  return (data.files || []).map(function(fileData) {
    return {
      id: fileData.id,
      name: fileData.name,
      mimeType: fileData.mimeType,
      createdTime: fileData.createdTime,
      properties: fileData.properties || {}
    };
  });
}

/**
 * Calls Claude API to annotate an image.
 */
function callClaudeAPI(apiKey, prompt, base64Image, mimeType) {
  var url = 'https://api.anthropic.com/v1/messages';
  
  var payload = {
    model: 'claude-sonnet-4-6',
    max_tokens: 150,
    messages: [{
      role: 'user',
      content: [
        {
          type: 'image',
          source: {
            type: 'base64',
            media_type: mimeType,
            data: base64Image
          }
        },
        {
          type: 'text',
          text: prompt
        }
      ]
    }]
  };
  
  var response = UrlFetchApp.fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });
  
  var code = response.getResponseCode();
  if (code !== 200) {
    throw new Error('Claude API error ' + code + ': ' + response.getContentText());
  }
  
  var result = JSON.parse(response.getContentText());
  var caption = result.content[0].text.trim();
  
  return {
    caption: caption,
    model: 'claude-sonnet-4-6',
    timestamp: new Date().toISOString()
  };
}

/**
 * Stores annotation in file metadata, splitting across properties if needed.
 */
function storeAnnotationInMetadata(fileId, annotation) {
  var token = ScriptApp.getOAuthToken();
  var caption = annotation.caption;
  
  var properties = {
    'ai_caption': caption.substring(0, 124),
    'ai_model': annotation.model,
    'ai_timestamp': annotation.timestamp
  };
  
  // If caption is longer than 124 chars, split across multiple properties
  if (caption.length > 124) {
    var chunks = [];
    for (var i = 0; i < caption.length; i += 124) {
      chunks.push(caption.substring(i, i + 124));
    }
    
    for (var j = 0; j < chunks.length; j++) {
      properties['ai_caption_' + (j + 1)] = chunks[j];
    }
  }
  
  // Update file properties via Drive API
  var url = DRIVE_FILES_URL + '/' + fileId + '?fields=properties';
  var response = UrlFetchApp.fetch(url, {
    method: 'PATCH',
    headers: {
      'Authorization': 'Bearer ' + token,
      'Content-Type': 'application/json'
    },
    payload: JSON.stringify({
      properties: properties
    }),
    muteHttpExceptions: true
  });
  
  if (response.getResponseCode() !== 200) {
    throw new Error('Failed to update file properties: ' + response.getContentText());
  }
}

/**
 * Retrieves full caption from file metadata (reconstructs if split).
 */
function getFullCaption(fileId) {
  var token = ScriptApp.getOAuthToken();
  var url = DRIVE_FILES_URL + '/' + fileId + '?fields=properties';
  
  var response = UrlFetchApp.fetch(url, {
    headers: { 'Authorization': 'Bearer ' + token },
    muteHttpExceptions: true
  });
  
  if (response.getResponseCode() !== 200) {
    return '';
  }
  
  var data = JSON.parse(response.getContentText());
  var properties = data.properties || {};
  
  var caption = properties.ai_caption || '';
  
  // Check for additional chunks
  var i = 1;
  var chunk;
  while ((chunk = properties['ai_caption_' + i])) {
    caption += chunk;
    i++;
  }
  
  return caption;
}

/**
 * Setup function - run once to set your Claude API key and prompt.
 */
function setupAnnotation() {
  var properties = PropertiesService.getScriptProperties();
  
  // Set your Claude API key here (run once, then delete this line for security)
  // properties.setProperty('CLAUDE_API_KEY', 'your-api-key-here');
  
  // Set your annotation prompt
  properties.setProperty('ANNOTATION_PROMPT', 
    'Describe this image in 1-2 sentences focusing on the main subject, activity, and setting. Add 2-3 relevant hashtags at the end. Keep total under 120 chars. Examples: "Friends dancing at a studio performance #dance #performance #friends" or "Mirror selfie with three guys hanging out #selfie #friends #casual"');
  
  Logger.log('Setup complete. Remember to set CLAUDE_API_KEY in the properties.');
}

// ============================================================
// CLEANUP
// ============================================================

/**
 * Deletes all Blogger posts (any status) updated on or after a given date.
 * Usage: deletePostsSince('2026-03-12') to wipe today's test posts.
 */
function deletePostsSince(sinceDateStr) {
  var since    = new Date(sinceDateStr || new Date().toDateString());
  var token    = ScriptApp.getOAuthToken();
  var deleted  = 0;
  var skipped  = 0;
  var pageToken = null;

  do {
    var url = BLOGGER_POSTS_URL +
      '?status=draft&status=live&status=scheduled&maxResults=50' +
      '&fields=nextPageToken,items(id,title,updated)';
    if (pageToken) url += '&pageToken=' + encodeURIComponent(pageToken);

    var response = UrlFetchApp.fetch(url, {
      headers: { Authorization: 'Bearer ' + token },
      muteHttpExceptions: true
    });
    var data  = JSON.parse(response.getContentText());
    var posts = data.items || [];
    pageToken = data.nextPageToken || null;

    posts.forEach(function(post) {
      if (new Date(post.updated) >= since) {
        Utilities.sleep(500);
        var del = UrlFetchApp.fetch(BLOGGER_POSTS_URL + '/' + post.id, {
          method:             'delete',
          headers:            { Authorization: 'Bearer ' + token },
          muteHttpExceptions: true
        });
        var code = del.getResponseCode();
        if (code === 200 || code === 204) {
          Logger.log('Deleted: "' + post.title + '"');
          deleted++;
        } else {
          Logger.log('Failed to delete "' + post.title + '" — HTTP ' + code);
        }
      } else {
        skipped++;
      }
    });

  } while (pageToken);

  Logger.log('Done. Deleted: ' + deleted + ', skipped (older): ' + skipped);
}

// ============================================================
// DEBUG
// ============================================================

function browsePhotoFolder() {
  var token = ScriptApp.getOAuthToken();
  var url = DRIVE_FILES_URL +
    '?q=' + encodeURIComponent("'" + DRIVE_FOLDER_ID + "' in parents and mimeType contains 'image/'") +
    '&fields=files(id,name,mimeType,createdTime,modifiedTime,size,imageMediaMetadata)&pageSize=20&orderBy=modifiedTime desc';

  var response = UrlFetchApp.fetch(url, {
    headers:            { Authorization: 'Bearer ' + token },
    muteHttpExceptions: true
  });

  var data = JSON.parse(response.getContentText());
  console.log('Files found: ' + (data.files ? data.files.length : 0));
  console.log('Sample: ' + JSON.stringify(data.files, null, 2));
}

function inspectFolders() {
  var token    = ScriptApp.getOAuthToken();
  var folderIds = getAllFolderIds(DRIVE_FOLDER_ID);
  Logger.log('Total folders found: ' + folderIds.length);

  folderIds.forEach(function(folderId) {
    var url = DRIVE_FILES_URL + '/' + folderId +
      '?fields=id,name,parents';
    var response = UrlFetchApp.fetch(url, {
      headers: { Authorization: 'Bearer ' + token },
      muteHttpExceptions: true
    });
    var f = JSON.parse(response.getContentText());
    Logger.log('Folder: "' + f.name + '" id=' + f.id + ' parent=' + (f.parents ? f.parents[0] : 'none'));
  });
}

function checkDuplicates() {
  var token     = ScriptApp.getOAuthToken();
  var folderIds = getAllFolderIds(DRIVE_FOLDER_ID);
  var nameCounts = {};

  folderIds.forEach(function(folderId) {
    var pageToken = null;
    do {
      var url = DRIVE_FILES_URL +
        '?q=' + encodeURIComponent("'" + folderId + "' in parents and mimeType contains 'image/' and trashed = false") +
        '&fields=files(id,name)&pageSize=100';
      if (pageToken) url += '&pageToken=' + encodeURIComponent(pageToken);

      var response = UrlFetchApp.fetch(url, {
        headers: { Authorization: 'Bearer ' + token },
        muteHttpExceptions: true
      });
      var data = JSON.parse(response.getContentText());
      if (data.files) {
        data.files.forEach(function(f) {
          nameCounts[f.name] = (nameCounts[f.name] || 0) + 1;
        });
      }
      pageToken = data.nextPageToken || null;
    } while (pageToken);
  });

  var dupes = Object.keys(nameCounts).filter(function(n) { return nameCounts[n] > 1; });
  Logger.log('Files appearing in multiple folders: ' + dupes.length);
  Logger.log('Examples: ' + JSON.stringify(dupes.slice(0, 10)));
}

function investigateDuplicates() {
  var range  = getLastWeekDateRange();
  var photos = fetchPhotosInRange(range.monday, range.sunday);
  Logger.log('Total photos found for last week: ' + photos.length);

  var token = ScriptApp.getOAuthToken();
  photos.forEach(function(photo) {
    var url = DRIVE_FILES_URL + '/' + photo.id +
      '?fields=id,name,parents,imageMediaMetadata(time)';
    var response = UrlFetchApp.fetch(url, {
      headers: { Authorization: 'Bearer ' + token },
      muteHttpExceptions: true
    });
    var f = JSON.parse(response.getContentText());

    // Get parent folder name
    var parentId = f.parents ? f.parents[0] : 'unknown';
    var folderUrl = DRIVE_FILES_URL + '/' + parentId + '?fields=name';
    var folderResp = UrlFetchApp.fetch(folderUrl, {
      headers: { Authorization: 'Bearer ' + token },
      muteHttpExceptions: true
    });
    var folder = JSON.parse(folderResp.getContentText());

    Logger.log(f.name + ' | folder: ' + folder.name + ' | exif: ' + (f.imageMediaMetadata ? f.imageMediaMetadata.time : 'none'));
  });
}

function listAllDrafts() {
  var token    = ScriptApp.getOAuthToken();
  var url      = BLOGGER_POSTS_URL + '?status=draft&status=live&status=scheduled&maxResults=50&fields=items(id,title,status,published,updated)';
  var response = UrlFetchApp.fetch(url, {
    headers: { Authorization: 'Bearer ' + token },
    muteHttpExceptions: true
  });
  var data = JSON.parse(response.getContentText());
  var posts = data.items || [];
  Logger.log('Total drafts: ' + posts.length);
  posts.forEach(function(p) {
    Logger.log(p.id + ' | ' + p.title + ' | updated: ' + p.updated);
  });
}

function checkScopes() {
  var token = ScriptApp.getOAuthToken();
  var response = UrlFetchApp.fetch(
    'https://oauth2.googleapis.com/tokeninfo?access_token=' + token,
    { muteHttpExceptions: true }
  );
  console.log(response.getContentText());
}

// ============================================================
// SECTION 1 — GOOGLE DRIVE HELPERS
// ============================================================

/**
 * Returns the Monday and Sunday bounding the most recent full week.
 */
function getLastWeekDateRange() {
  var now   = new Date();
  var today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  var dayOfWeek        = today.getDay(); // 0=Sun, 1=Mon … 6=Sat
  var daysToLastMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  var monday           = new Date(today);
  monday.setDate(today.getDate() - daysToLastMonday - 7);

  var sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);

  return { monday: monday, sunday: sunday };
}

/**
 * Recursively collects all folder IDs under rootFolderId (including root).
 */
function getAllFolderIds(rootFolderId) {
  var token  = ScriptApp.getOAuthToken();
  var allIds = [rootFolderId];
  var queue  = [rootFolderId];

  while (queue.length > 0) {
    var parentId = queue.shift();
    var url = DRIVE_FILES_URL +
      '?q=' + encodeURIComponent(
        "'" + parentId + "' in parents" +
        " and mimeType = 'application/vnd.google-apps.folder'" +
        " and trashed = false"
      ) +
      '&fields=files(id)&pageSize=100';

    var response = UrlFetchApp.fetch(url, {
      headers:            { Authorization: 'Bearer ' + token },
      muteHttpExceptions: true
    });

    var data = JSON.parse(response.getContentText());
    if (data.files) {
      data.files.forEach(function(f) {
        allIds.push(f.id);
        queue.push(f.id);
      });
    }
  }

  return allIds;
}

/**
 * Parses an EXIF date string "YYYY:MM:DD HH:MM:SS" into a Date object.
 */
function parseExifDate(exifTime) {
  // Format: "2025:06:10 10:19:56"
  return new Date(
    exifTime.substring(0, 4)  + '-' +
    exifTime.substring(5, 7)  + '-' +
    exifTime.substring(8, 10) + 'T' +
    exifTime.substring(11)
  );
}

/**
 * Fetches all photos from the Drive folder (recursively) whose EXIF capture
 * date falls between startDate and endDate inclusive.
 * Uses imageMediaMetadata.time (immutable EXIF) rather than modifiedTime,
 * which changes when file permissions are updated.
 */
function fetchPhotosInRange(startDate, endDate) {
  var token     = ScriptApp.getOAuthToken();
  var folderIds = getAllFolderIds(DRIVE_FOLDER_ID);
  Logger.log('Searching in ' + folderIds.length + ' folder(s).');

  var startMs = startDate.getTime();
  var endMs   = endDate.getTime() + 86400000; // include all of endDate

  var allItems  = [];
  var batchSize = 20;

  for (var i = 0; i < folderIds.length; i += batchSize) {
    var batch       = folderIds.slice(i, i + batchSize);
    var parentQuery = batch.map(function(id) { return "'" + id + "' in parents"; }).join(' or ');
    var query       = '(' + parentQuery + ") and mimeType contains 'image/' and trashed = false";

    var pageToken = null;
    do {
      var url = DRIVE_FILES_URL +
        '?q='      + encodeURIComponent(query) +
        '&fields=' + encodeURIComponent('nextPageToken,files(id,name,mimeType,imageMediaMetadata(time))') +
        '&pageSize=100';

      if (pageToken) url += '&pageToken=' + encodeURIComponent(pageToken);

      var response = UrlFetchApp.fetch(url, {
        headers:            { Authorization: 'Bearer ' + token },
        muteHttpExceptions: true
      });

      var code = response.getResponseCode();
      if (code !== 200) {
        throw new Error('Drive API error ' + code + ': ' + response.getContentText());
      }

      var data = JSON.parse(response.getContentText());
      if (data.files) {
        data.files.forEach(function(f) {
          if (!f.imageMediaMetadata || !f.imageMediaMetadata.time) return;
          var photoDate = parseExifDate(f.imageMediaMetadata.time);
          var ms        = photoDate.getTime();
          if (ms >= startMs && ms < endMs) {
            allItems.push({ id: f.id, name: f.name, mimeType: f.mimeType, photoDate: photoDate });
          }
        });
      }
      pageToken = data.nextPageToken || null;

    } while (pageToken);
  }

  allItems.sort(function(a, b) { return a.photoDate - b.photoDate; });
  return allItems;
}

// ============================================================
// SECTION 2 — DATE FORMATTING & HTML BODY BUILDER
// ============================================================

function formatDate(date) {
  var months = [
    'January','February','March','April','May','June',
    'July','August','September','October','November','December'
  ];
  return months[date.getMonth()] + ' ' + date.getDate() + ', ' + date.getFullYear();
}

function formatWeekRange(monday, sunday) {
  var months = [
    'January','February','March','April','May','June',
    'July','August','September','October','November','December'
  ];
  var mondayStr = months[monday.getMonth()] + ' ' + monday.getDate();
  var sundayStr = months[sunday.getMonth()] + ' '  + sunday.getDate();
  return 'Week of ' + mondayStr + ' \u2014 ' + sundayStr + ', ' + sunday.getFullYear();
}

function buildSinglePhotoHtml(photo) {
  return '<figure>' +
    '<img src="' + photo.url + '" alt="' + photo.caption + '" />' +
    '<figcaption>' + photo.caption + '</figcaption>' +
    '</figure>';
}

function buildCombinedPostHtml(photos) {
  if (photos.length === 0) return '<p><em>No photos this week.</em></p>';
  return photos.map(function(p) { return buildSinglePhotoHtml(p); }).join('\n');
}

// ============================================================
// SECTION 3 — MAKE PHOTOS PUBLIC (DRIVE → DIRECT URL)
// ============================================================

/**
 * Sets a Drive file to be publicly readable and returns a direct embed URL.
 */
function makePhotoPublic(fileId) {
  var token    = ScriptApp.getOAuthToken();
  var response = UrlFetchApp.fetch(DRIVE_FILES_URL + '/' + fileId + '/permissions', {
    method:  'post',
    headers: {
      Authorization:  'Bearer ' + token,
      'Content-Type': 'application/json'
    },
    payload:            JSON.stringify({ role: 'reader', type: 'anyone' }),
    muteHttpExceptions: true
  });

  var code = response.getResponseCode();
  if (code !== 200 && code !== 201) {
    throw new Error('Failed to make photo public (HTTP ' + code + '): ' + response.getContentText());
  }

  return 'https://lh3.googleusercontent.com/d/' + fileId;
}

// ============================================================
// SECTION 4 — BLOGGER POST CREATION
// ============================================================

function createBloggerDraft(title, content) {
  var token = ScriptApp.getOAuthToken();

  var response = UrlFetchApp.fetch(BLOGGER_POSTS_URL + '?isDraft=true', {
    method:  'post',
    headers: {
      Authorization:  'Bearer ' + token,
      'Content-Type': 'application/json'
    },
    payload: JSON.stringify({
      title:   title,
      content: content,
      labels:  ['journal', 'weekly']
    }),
    muteHttpExceptions: true
  });

  var code = response.getResponseCode();
  if (code !== 200 && code !== 201) {
    throw new Error('Blogger API error ' + code + ': ' + response.getContentText());
  }

  return JSON.parse(response.getContentText());
}

// ============================================================
// SECTION 5 — WEEKLY JOURNAL FUNCTION (main entry point)
// ============================================================

/**
 * Creates one draft post per photo, plus one combined post for the week.
 * Pass date strings to target a specific week, e.g.:
 *   clasp run createWeeklyJournalDraft --params '[["2024-03-11","2024-03-17"]]'
 * With no args, defaults to the most recent full week.
 */
function createWeeklyJournalDraft(startDateStr, endDateStr) {
  var monday, sunday;

  if (startDateStr && endDateStr) {
    monday = new Date(startDateStr);
    sunday = new Date(endDateStr);
  } else {
    var range = getLastWeekDateRange();
    monday    = range.monday;
    sunday    = range.sunday;
  }

  var weekTitle = formatWeekRange(monday, sunday);
  Logger.log('Starting: ' + weekTitle);
  Logger.log('Date range: ' + formatDate(monday) + ' to ' + formatDate(sunday));

  var photos = fetchPhotosInRange(monday, sunday);
  Logger.log('Found ' + photos.length + ' photo(s).');

  if (photos.length === 0) {
    Logger.log('No photos found for this date range. Done.');
    return;
  }

  // Make all photos public and build photo objects
  var hostedPhotos = [];
  photos.forEach(function(item, index) {
    Logger.log('Processing photo ' + (index + 1) + ' of ' + photos.length + '…');
    try {
      var url     = makePhotoPublic(item.id);
      var caption = formatDate(item.photoDate);
      hostedPhotos.push({ url: url, caption: caption, name: item.name });
    } catch (e) {
      Logger.log('WARNING: skipping ' + item.name + ' — ' + e.message);
    }
  });
  Logger.log('Processed ' + hostedPhotos.length + ' photo(s).');

  // One draft post per photo
  var created = 0;
  hostedPhotos.forEach(function(photo, index) {
    var attempts = 0;
    var success  = false;
    while (!success && attempts < 3) {
      try {
        Utilities.sleep(3000);
        var post = createBloggerDraft(weekTitle + ' — ' + photo.caption, buildSinglePhotoHtml(photo));
        Logger.log('Draft ' + (index + 1) + ' created: ' + post.id + ' (' + photo.name + ')');
        created++;
        success = true;
      } catch (e) {
        attempts++;
        if (e.message.indexOf('429') !== -1 && attempts < 3) {
          var wait = attempts * 30000;
          Logger.log('Rate limited on photo ' + (index + 1) + ', waiting ' + (wait/1000) + 's (attempt ' + attempts + ')…');
          Utilities.sleep(wait);
        } else {
          Logger.log('WARNING: skipping draft ' + (index + 1) + ' — ' + e.message);
          success = true; // exit loop
        }
      }
    }
  });

  GmailApp.sendEmail(
    NOTIFICATION_EMAIL,
    'Your weekly journal is ready \u270d\ufe0f',
    'Hi Kate,\n\n' +
    'Week: ' + weekTitle + '\n' +
    'Posts created: ' + created + ' of ' + hostedPhotos.length + '\n\n' +
    'Review your drafts:\nhttps://www.blogger.com/blog/posts/' + BLOG_ID + '\n\n' +
    'Have a great week! \ud83d\udcf8'
  );
  Logger.log('Done. Created ' + created + ' draft posts.');
}

// ============================================================
// SECTION 6 — TRIGGER SETUP
// ============================================================

/**
 * Run this function ONCE to install a weekly Monday 9am trigger.
 */
function createWeeklyTrigger() {
  var triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(function(trigger) {
    if (trigger.getHandlerFunction() === 'createWeeklyJournalDraft') {
      ScriptApp.deleteTrigger(trigger);
      Logger.log('Removed existing trigger.');
    }
  });

  ScriptApp.newTrigger('createWeeklyJournalDraft')
    .timeBased()
    .onWeekDay(ScriptApp.WeekDay.MONDAY)
    .atHour(9)
    .create();

  Logger.log('Weekly trigger created: every Monday at 9 AM.');
}
