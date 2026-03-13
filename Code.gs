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

/**
 * Migrates existing AI captions from custom properties to visible Description field
 */
function migrateAICaptionsToDescription() {
  Logger.log('Starting migration of AI captions to Description field...');
  
  var images = getImagesFromFolder(DRIVE_FOLDER_ID, 10); // Get more to find annotated ones
  var migrated = 0;
  
  images.forEach(function(image) {
    try {
      // Check if it has an AI caption in custom properties
      var aiCaption = image.properties && image.properties.ai_caption;
      if (aiCaption) {
        Logger.log('Migrating caption for: ' + image.name);
        
        // Get full caption (handles split captions)
        var fullCaption = getFullCaption(image.id);
        
        if (fullCaption) {
          // Update the description field via Drive API
          var url = DRIVE_FILES_URL + '/' + image.id;
          var payload = {
            description: fullCaption
          };
          
          var options = {
            method: 'PATCH',
            headers: {
              'Authorization': 'Bearer ' + ScriptApp.getOAuthToken(),
              'Content-Type': 'application/json'
            },
            payload: JSON.stringify(payload)
          };
          
          var response = UrlFetchApp.fetch(url, options);
          if (response.getResponseCode() === 200) {
            Logger.log('✅ Migrated: ' + fullCaption);
            migrated++;
          } else {
            Logger.log('❌ Failed to migrate ' + image.name + ': ' + response.getContentText());
          }
        }
      }
    } catch (e) {
      Logger.log('ERROR migrating ' + image.name + ': ' + e.message);
    }
  });
  
  Logger.log('Migration complete. Migrated ' + migrated + ' captions to Description field.');
}

// ============================================================
// HYBRID RECOGNITION SYSTEM
// ============================================================

/**
 * Hybrid Recognition System for faces, screenshots, and apps
 * Uses Google Vision API + custom learning database
 */

// Constants for Vision API
var VISION_API_URL = 'https://vision.googleapis.com/v1/images:annotate';
var KNOWLEDGE_BASE_FILE = 'photo-journal-knowledge-base.json';

/**
 * Main function to analyze an image with hybrid recognition
 */
function analyzeImageWithVision(fileId) {
  Logger.log('Analyzing image with Vision API: ' + fileId);
  
  try {
    // Get image data
    var file = DriveApp.getFileById(fileId);
    var blob = file.getBlob();
    var base64 = Utilities.base64Encode(blob.getBytes());
    
    // Call Vision API for multiple detection types
    var visionResults = callVisionAPI(base64);
    
    // Process results
    var analysis = {
      faces: processFaceDetection(visionResults.faces || []),
      text: processTextDetection(visionResults.text || []),
      objects: processObjectDetection(visionResults.objects || []),
      suggestions: []
    };
    
    // Generate smart suggestions based on analysis + knowledge base
    analysis.suggestions = generateSmartSuggestions(analysis);
    
    Logger.log('Vision analysis complete: ' + JSON.stringify(analysis));
    return analysis;
    
  } catch (e) {
    Logger.log('ERROR in analyzeImageWithVision: ' + e.message);
    return null;
  }
}

/**
 * Call Google Vision API with multiple feature types
 */
function callVisionAPI(base64Image) {
  var payload = {
    requests: [{
      image: {
        content: base64Image
      },
      features: [
        { type: 'FACE_DETECTION', maxResults: 10 },
        { type: 'TEXT_DETECTION', maxResults: 1 },
        { type: 'OBJECT_LOCALIZATION', maxResults: 10 }
      ]
    }]
  };
  
  var options = {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + ScriptApp.getOAuthToken(),
      'Content-Type': 'application/json'
    },
    payload: JSON.stringify(payload)
  };
  
  var response = UrlFetchApp.fetch(VISION_API_URL, options);
  var result = JSON.parse(response.getContentText());
  
  if (result.responses && result.responses[0]) {
    return {
      faces: result.responses[0].faceAnnotations,
      text: result.responses[0].textAnnotations,
      objects: result.responses[0].localizedObjectAnnotations
    };
  }
  
  return {};
}

/**
 * Process face detection results
 */
function processFaceDetection(faces) {
  var faceData = [];
  
  faces.forEach(function(face, index) {
    // Extract face bounding box and confidence
    var bounds = face.boundingPoly.vertices;
    var faceInfo = {
      id: 'face_' + index,
      bounds: bounds,
      confidence: face.detectionConfidence || 0.5,
      landmarks: face.landmarks || [],
      // Try to match against known faces
      possibleMatch: matchFaceToKnownPeople(face)
    };
    
    faceData.push(faceInfo);
  });
  
  return faceData;
}

/**
 * Process text detection for app/screenshot recognition
 */
function processTextDetection(textAnnotations) {
  if (!textAnnotations || textAnnotations.length === 0) {
    return { fullText: '', apps: [], contexts: [] };
  }
  
  var fullText = textAnnotations[0].description || '';
  
  return {
    fullText: fullText,
    apps: detectAppsFromText(fullText),
    contexts: detectContextFromText(fullText)
  };
}

/**
 * Process object detection results
 */
function processObjectDetection(objects) {
  var objectData = [];
  
  objects.forEach(function(obj) {
    objectData.push({
      name: obj.name,
      confidence: obj.score,
      bounds: obj.boundingPoly
    });
  });
  
  return objectData;
}

/**
 * Detect apps from text content
 */
function detectAppsFromText(text) {
  var apps = [];
  var appPatterns = {
    'Duolingo': /duolingo/i,
    'LingQ': /lingq/i,
    'Spotify': /spotify/i,
    'Instagram': /instagram/i,
    'Twitter': /twitter/i,
    'LinkedIn': /linkedin/i
  };
  
  for (var app in appPatterns) {
    if (appPatterns[app].test(text)) {
      apps.push(app);
    }
  }
  
  return apps;
}

/**
 * Detect context from text content
 */
function detectContextFromText(text) {
  var contexts = [];
  var contextPatterns = {
    'spanish_learning': /spanish|español|duolingo|lingq/i,
    'social_media': /instagram|twitter|facebook|linkedin/i,
    'music': /spotify|music|song|playlist/i,
    'work': /meeting|email|slack|zoom|calendar/i
  };
  
  for (var context in contextPatterns) {
    if (contextPatterns[context].test(text)) {
      contexts.push(context);
    }
  }
  
  return contexts;
}

/**
 * Try to match detected face to known people
 */
function matchFaceToKnownPeople(face) {
  // This will be enhanced with actual face matching logic
  // For now, return null (no match)
  return null;
}

/**
 * Generate smart tag suggestions based on analysis
 */
function generateSmartSuggestions(analysis) {
  var suggestions = [];
  
  // Face-based suggestions
  if (analysis.faces.length > 0) {
    if (analysis.faces.length === 1) {
      suggestions.push('#photo:portrait');
    } else if (analysis.faces.length > 1) {
      suggestions.push('#photo:group');
    }
  }
  
  // App-based suggestions
  analysis.text.apps.forEach(function(app) {
    suggestions.push('#app:' + app);
  });
  
  // Context-based suggestions
  analysis.text.contexts.forEach(function(context) {
    switch(context) {
      case 'spanish_learning':
        suggestions.push('#hobby:spanish');
        break;
      case 'social_media':
        suggestions.push('#activity:social');
        break;
      case 'music':
        suggestions.push('#activity:music');
        break;
      case 'work':
        suggestions.push('#context:work');
        break;
    }
  });
  
  // Object-based suggestions
  analysis.objects.forEach(function(obj) {
    if (obj.confidence > 0.7) {
      suggestions.push('#object:' + obj.name.toLowerCase().replace(/\s+/g, ''));
    }
  });
  
  return suggestions;
}

/**
 * Enhanced annotation function using hybrid recognition
 */
function annotateImagesWithVision() {
  Logger.log('Starting enhanced image annotation with Vision API...');
  
  var prompt = getAnnotationPrompt();
  if (!prompt) {
    Logger.log('ERROR: No annotation prompt found. Run setupAnnotation() first.');
    return;
  }

  var apiKey = PropertiesService.getScriptProperties().getProperty('CLAUDE_API_KEY');
  if (!apiKey) {
    Logger.log('ERROR: No Claude API key found. Add CLAUDE_API_KEY to Script Properties.');
    return;
  }

  var images = getImagesFromFolder(DRIVE_FOLDER_ID, 3); // Process 3 at a time for testing
  Logger.log('Found ' + images.length + ' images to process with Vision');

  var processed = 0;
  images.forEach(function(image, index) {
    try {
      // Skip if already annotated (for now)
      var existingCaption = image.properties && image.properties.ai_caption;
      if (existingCaption) {
        Logger.log('Skipping ' + image.name + ' - already annotated');
        return;
      }

      Logger.log('Processing image ' + (index + 1) + ': ' + image.name);

      var file = DriveApp.getFileById(image.id);
      var blob = file.getBlob();

      // Skip if image is too large
      if (blob.getBytes().length > 4000000) {
        Logger.log('Skipping large image: ' + image.name + ' (' + Math.round(blob.getBytes().length/1024/1024*100)/100 + 'MB)');
        return;
      }

      // Analyze with Vision API
      var visionAnalysis = analyzeImageWithVision(image.id);
      
      // Create enhanced prompt with Vision insights
      var enhancedPrompt = createEnhancedPrompt(prompt, visionAnalysis);
      
      var base64 = Utilities.base64Encode(blob.getBytes());
      var annotation = callClaudeAPI(apiKey, enhancedPrompt, base64, image.mimeType);

      // Store annotation in description field
      storeAnnotationInDescription(image.id, annotation.caption);
      
      // Store Vision analysis data for learning
      storeVisionAnalysis(image.id, visionAnalysis);

      processed++;
      Logger.log('Enhanced annotation: ' + annotation.caption);
      Logger.log('Vision suggestions: ' + JSON.stringify(visionAnalysis.suggestions));

    } catch (e) {
      Logger.log('ERROR processing ' + image.name + ': ' + e.message);
    }
  });
  
  Logger.log('Enhanced annotation complete. Processed ' + processed + ' images.');
}

/**
 * Create enhanced prompt with Vision API insights
 */
function createEnhancedPrompt(basePrompt, visionAnalysis) {
  if (!visionAnalysis) return basePrompt;
  
  var enhancements = [];
  
  // Add face information
  if (visionAnalysis.faces && visionAnalysis.faces.length > 0) {
    enhancements.push('Image contains ' + visionAnalysis.faces.length + ' person(s)');
  }
  
  // Add detected apps
  if (visionAnalysis.text && visionAnalysis.text.apps.length > 0) {
    enhancements.push('Detected apps: ' + visionAnalysis.text.apps.join(', '));
  }
  
  // Add text context
  if (visionAnalysis.text && visionAnalysis.text.fullText) {
    var textSnippet = visionAnalysis.text.fullText.substring(0, 100);
    if (textSnippet.trim()) {
      enhancements.push('Text visible: "' + textSnippet + '"');
    }
  }
  
  if (enhancements.length > 0) {
    return basePrompt + '\n\nAdditional context: ' + enhancements.join('. ') + '.';
  }
  
  return basePrompt;
}

/**
 * Store annotation in visible description field
 */
function storeAnnotationInDescription(fileId, caption) {
  var url = DRIVE_FILES_URL + '/' + fileId;
  var payload = {
    description: caption
  };
  
  var options = {
    method: 'PATCH',
    headers: {
      'Authorization': 'Bearer ' + ScriptApp.getOAuthToken(),
      'Content-Type': 'application/json'
    },
    payload: JSON.stringify(payload)
  };
  
  UrlFetchApp.fetch(url, options);
}

/**
 * Store Vision analysis data for learning
 */
function storeVisionAnalysis(fileId, analysis) {
  // Store in a separate knowledge base file for later learning
  var knowledgeBase = getKnowledgeBase();
  
  if (!knowledgeBase.visionData) {
    knowledgeBase.visionData = {};
  }
  
  knowledgeBase.visionData[fileId] = {
    timestamp: new Date().toISOString(),
    analysis: analysis
  };
  
  saveKnowledgeBase(knowledgeBase);
}

/**
 * Get or create knowledge base
 */
function getKnowledgeBase() {
  try {
    var files = DriveApp.getFilesByName(KNOWLEDGE_BASE_FILE);
    if (files.hasNext()) {
      var file = files.next();
      var content = file.getBlob().getDataAsString();
      return JSON.parse(content);
    }
  } catch (e) {
    Logger.log('Creating new knowledge base: ' + e.message);
  }
  
  // Create new knowledge base
  return {
    version: '1.0',
    created: new Date().toISOString(),
    faceDatabase: {},
    appPatterns: {},
    contextPatterns: {},
    visionData: {}
  };
}

/**
 * Save knowledge base to Drive
 */
function saveKnowledgeBase(knowledgeBase) {
  var content = JSON.stringify(knowledgeBase, null, 2);
  
  try {
    var files = DriveApp.getFilesByName(KNOWLEDGE_BASE_FILE);
    if (files.hasNext()) {
      var file = files.next();
      file.setContent(content);
    } else {
      DriveApp.createFile(KNOWLEDGE_BASE_FILE, content, 'application/json');
    }
  } catch (e) {
    Logger.log('ERROR saving knowledge base: ' + e.message);
  }
}

// ============================================================
// TRAINING & LEARNING FUNCTIONS
// ============================================================

/**
 * Learn from user corrections by scanning Drive descriptions
 * This function looks for changes you made to AI-generated captions
 */
function learnFromCorrections() {
  Logger.log('Starting learning process from user corrections...');
  
  var images = getImagesFromFolder(DRIVE_FOLDER_ID, 20); // Check recent images
  var knowledgeBase = getKnowledgeBase();
  var learningCount = 0;
  
  images.forEach(function(image) {
    try {
      // Get current description from Drive
      var currentDescription = getFileDescription(image.id);
      
      // Get stored Vision analysis
      var storedAnalysis = knowledgeBase.visionData[image.id];
      
      if (currentDescription && storedAnalysis) {
        // Compare current description with original AI suggestions
        var learnings = extractLearningsFromCorrection(currentDescription, storedAnalysis);
        
        if (learnings.length > 0) {
          Logger.log('Learning from ' + image.name + ': ' + JSON.stringify(learnings));
          
          // Update knowledge base with learnings
          learnings.forEach(function(learning) {
            updateKnowledgeBase(knowledgeBase, learning);
          });
          
          learningCount++;
        }
      }
    } catch (e) {
      Logger.log('ERROR learning from ' + image.name + ': ' + e.message);
    }
  });
  
  if (learningCount > 0) {
    saveKnowledgeBase(knowledgeBase);
    Logger.log('Learning complete. Updated knowledge base from ' + learningCount + ' corrections.');
  } else {
    Logger.log('No new learnings found.');
  }
}

/**
 * Get file description from Drive
 */
function getFileDescription(fileId) {
  try {
    var url = DRIVE_FILES_URL + '/' + fileId + '?fields=description';
    var options = {
      method: 'GET',
      headers: {
        'Authorization': 'Bearer ' + ScriptApp.getOAuthToken()
      }
    };
    
    var response = UrlFetchApp.fetch(url, options);
    var result = JSON.parse(response.getContentText());
    return result.description || '';
  } catch (e) {
    Logger.log('ERROR getting description for ' + fileId + ': ' + e.message);
    return '';
  }
}

/**
 * Extract learnings from user corrections
 */
function extractLearningsFromCorrection(userDescription, visionAnalysis) {
  var learnings = [];
  
  // Parse user tags from description
  var userTags = extractTagsFromDescription(userDescription);
  
  // Learn from structured tags
  userTags.forEach(function(tag) {
    if (tag.includes(':')) {
      var parts = tag.split(':');
      var category = parts[0];
      var value = parts[1];
      
      // Learn associations with Vision data
      if (category === 'person' && visionAnalysis.faces && visionAnalysis.faces.length > 0) {
        learnings.push({
          type: 'person_face_association',
          person: value,
          faceData: visionAnalysis.faces[0], // Assume first face for now
          context: userDescription
        });
      }
      
      if (category === 'app' && visionAnalysis.text) {
        learnings.push({
          type: 'app_text_association',
          app: value,
          textData: visionAnalysis.text.fullText,
          context: userDescription
        });
      }
      
      if (category === 'location' && visionAnalysis.text) {
        learnings.push({
          type: 'location_context_association',
          location: value,
          textData: visionAnalysis.text.fullText,
          objectData: visionAnalysis.objects,
          context: userDescription
        });
      }
    }
  });
  
  return learnings;
}

/**
 * Extract hashtags from description text
 */
function extractTagsFromDescription(description) {
  var tagPattern = /#[\w:]+/g;
  var matches = description.match(tagPattern) || [];
  return matches.map(function(tag) { return tag.substring(1); }); // Remove #
}

/**
 * Update knowledge base with new learning
 */
function updateKnowledgeBase(knowledgeBase, learning) {
  switch(learning.type) {
    case 'person_face_association':
      if (!knowledgeBase.faceDatabase[learning.person]) {
        knowledgeBase.faceDatabase[learning.person] = {
          faceExamples: [],
          confidence: 0
        };
      }
      knowledgeBase.faceDatabase[learning.person].faceExamples.push({
        faceData: learning.faceData,
        context: learning.context,
        timestamp: new Date().toISOString()
      });
      break;
      
    case 'app_text_association':
      if (!knowledgeBase.appPatterns[learning.app]) {
        knowledgeBase.appPatterns[learning.app] = {
          textPatterns: [],
          confidence: 0
        };
      }
      knowledgeBase.appPatterns[learning.app].textPatterns.push({
        text: learning.textData,
        context: learning.context,
        timestamp: new Date().toISOString()
      });
      break;
      
    case 'location_context_association':
      if (!knowledgeBase.contextPatterns[learning.location]) {
        knowledgeBase.contextPatterns[learning.location] = {
          textPatterns: [],
          objectPatterns: [],
          confidence: 0
        };
      }
      knowledgeBase.contextPatterns[learning.location].textPatterns.push({
        text: learning.textData,
        context: learning.context,
        timestamp: new Date().toISOString()
      });
      break;
  }
}

/**
 * Manual training function - label a specific image
 */
function trainOnImage(fileId, labels) {
  Logger.log('Training on image: ' + fileId + ' with labels: ' + JSON.stringify(labels));
  
  // Analyze image with Vision API
  var analysis = analyzeImageWithVision(fileId);
  
  if (!analysis) {
    Logger.log('ERROR: Could not analyze image');
    return;
  }
  
  var knowledgeBase = getKnowledgeBase();
  
  // Process each label
  labels.forEach(function(label) {
    if (label.type === 'person' && analysis.faces.length > 0) {
      // Train face recognition
      if (!knowledgeBase.faceDatabase[label.value]) {
        knowledgeBase.faceDatabase[label.value] = {
          faceExamples: [],
          confidence: 0
        };
      }
      
      // Add face example (use first face for simplicity)
      knowledgeBase.faceDatabase[label.value].faceExamples.push({
        faceData: analysis.faces[0],
        fileId: fileId,
        timestamp: new Date().toISOString()
      });
      
      Logger.log('Added face example for: ' + label.value);
    }
  });
  
  saveKnowledgeBase(knowledgeBase);
  Logger.log('Training complete for image: ' + fileId);
}

/**
 * Test function to manually train on Ben's face
 * Usage: trainOnBensFace('your-file-id-here')
 */
function trainOnBensFace(fileId) {
  trainOnImage(fileId, [
    { type: 'person', value: 'Ben' }
  ]);
}

/**
 * Test function to analyze a specific image with Vision API
 */
function testVisionOnSpecificImage() {
  // Get the first available image from the folder
  var images = getImagesFromFolder(DRIVE_FOLDER_ID, 1);
  
  if (images.length === 0) {
    Logger.log('No images found to test');
    return;
  }
  
  var testImage = images[0];
  Logger.log('Testing Vision API on: ' + testImage.name + ' (ID: ' + testImage.id + ')');
  
  var analysis = analyzeImageWithVision(testImage.id);
  
  if (analysis) {
    Logger.log('=== VISION ANALYSIS RESULTS ===');
    Logger.log('Faces detected: ' + (analysis.faces ? analysis.faces.length : 0));
    Logger.log('Text detected: ' + (analysis.text ? analysis.text.fullText.substring(0, 100) : 'None'));
    Logger.log('Apps detected: ' + JSON.stringify(analysis.text ? analysis.text.apps : []));
    Logger.log('Objects detected: ' + analysis.objects.length);
    Logger.log('Smart suggestions: ' + JSON.stringify(analysis.suggestions));
    Logger.log('=== END ANALYSIS ===');
  } else {
    Logger.log('Vision analysis failed');
  }
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
      
      // Try to get AI-generated caption first, fall back to date
      var aiCaption = getFullCaption(item.id);
      var caption = aiCaption || formatDate(item.photoDate);
      
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

// ============================================================
// THEME MANAGEMENT
// ============================================================

/**
 * Uploads a Blogger theme XML stored in Google Drive to this blog.
 * Usage: pass the Drive fileId of the XML file.
 * Run via: clasp run uploadThemeFromDrive --params '["<fileId>"]'
 */
function uploadThemeFromDrive(fileId) {
  var token = ScriptApp.getOAuthToken();

  // Read XML from Drive
  var driveUrl = 'https://www.googleapis.com/drive/v3/files/' + fileId + '?alt=media';
  var driveRes = UrlFetchApp.fetch(driveUrl, {
    headers: { Authorization: 'Bearer ' + token },
    muteHttpExceptions: true
  });
  if (driveRes.getResponseCode() !== 200) {
    throw new Error('Failed to read file from Drive: ' + driveRes.getContentText().substring(0, 300));
  }
  var xmlContent = driveRes.getContentText();
  Logger.log('Read theme XML from Drive: ' + xmlContent.length + ' chars');

  // PUT to Blogger template API
  var templateUrl = 'https://www.blogger.com/feeds/' + BLOG_ID + '/template/default';
  var res = UrlFetchApp.fetch(templateUrl, {
    method: 'put',
    headers: {
      Authorization: 'Bearer ' + token,
      'Content-Type': 'application/atom+xml',
      'GData-Version': '2'
    },
    payload: xmlContent,
    muteHttpExceptions: true
  });
  var status = res.getResponseCode();
  Logger.log('Upload response: HTTP ' + status);
  if (status < 200 || status >= 300) {
    throw new Error('Theme upload failed (HTTP ' + status + '): ' + res.getContentText().substring(0, 500));
  }
  Logger.log('Theme uploaded successfully!');
  return 'OK: HTTP ' + status;
}

/**
 * Test: GET the current template to verify the API endpoint works.
 */
function getThemeTest() {
  var token = ScriptApp.getOAuthToken();
  var templateUrl = 'https://www.blogger.com/feeds/' + BLOG_ID + '/template/default';
  var res = UrlFetchApp.fetch(templateUrl, {
    headers: {
      Authorization: 'Bearer ' + token,
      'GData-Version': '2'
    },
    muteHttpExceptions: true
  });
  Logger.log('GET template HTTP: ' + res.getResponseCode());
  Logger.log('Response (first 500): ' + res.getContentText().substring(0, 500));
  return res.getResponseCode();
}
