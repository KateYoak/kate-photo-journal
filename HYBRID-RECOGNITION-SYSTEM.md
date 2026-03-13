# Hybrid Recognition System Documentation

## Overview

The Hybrid Recognition System combines Google Vision API with Claude AI to provide intelligent photo annotation with learning capabilities. It can recognize:

- **Faces**: Detect and learn to identify people
- **Screenshots**: Recognize apps like Duolingo, LingQ, Spotify, etc.
- **Text Content**: Extract and understand text in images
- **Objects**: Identify objects and contexts
- **Learning**: Improve over time from your corrections

## System Architecture

```
Photo → Vision API → Analysis → Claude AI → Enhanced Caption
                      ↓
                Knowledge Base ← User Corrections ← Learning Engine
```

## Components

### 1. Vision API Integration
- **Face Detection**: Detects faces and extracts features for matching
- **OCR (Text Detection)**: Reads text from screenshots and images  
- **Object Detection**: Identifies objects, scenes, and contexts
- **Smart Analysis**: Combines all detection types for comprehensive understanding

### 2. Learning Database (JSON file in Drive)
```json
{
  "faceDatabase": {
    "Ben": {
      "faceExamples": [...],
      "confidence": 0.85
    }
  },
  "appPatterns": {
    "Duolingo": {
      "textPatterns": ["duolingo", "streak", "lesson"],
      "confidence": 0.95
    }
  },
  "contextPatterns": {
    "AtomicBallroom": {
      "textPatterns": ["ballroom", "dance class"],
      "objectPatterns": ["dance floor", "mirrors"]
    }
  }
}
```

### 3. Smart Tagging System
- **Structured Tags**: `#person:Ben`, `#location:AtomicBallroom`, `#app:Duolingo`
- **Context Tags**: `#hobby:spanish`, `#activity:dance`, `#photo:selfie`
- **Learning Tags**: System learns your patterns and suggests similar tags

## Setup Instructions

### 1. Enable Google Cloud Vision API
1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Select your project (or create one)
3. Enable the "Cloud Vision API"
4. Make sure billing is enabled (Vision API has free tier: 1000 requests/month)

### 2. Update Apps Script Permissions
The system already includes the required OAuth scope:
```json
"https://www.googleapis.com/auth/cloud-platform"
```

### 3. Test the System
```javascript
// Test Vision API on a single image
clasp run testVisionOnSpecificImage

// Run enhanced annotation with Vision
clasp run annotateImagesWithVision

// Learn from your corrections
clasp run learnFromCorrections
```

## Key Functions

### Analysis Functions
- `analyzeImageWithVision(fileId)` - Analyze single image with Vision API
- `annotateImagesWithVision()` - Enhanced annotation using Vision + Claude
- `testVisionOnSpecificImage()` - Test function for debugging

### Learning Functions  
- `learnFromCorrections()` - Scan for user corrections and learn patterns
- `trainOnImage(fileId, labels)` - Manually train on specific image
- `trainOnBensFace(fileId)` - Quick function to train face recognition

### Knowledge Base Functions
- `getKnowledgeBase()` - Load learning database
- `saveKnowledgeBase(data)` - Save learning database
- `updateKnowledgeBase(learning)` - Add new learning to database

## Usage Workflow

### 1. Initial Training
```javascript
// Train the system on Ben's face
trainOnBensFace('your-file-id-with-ben');

// Or train with multiple labels
trainOnImage('file-id', [
  { type: 'person', value: 'Ben' },
  { type: 'location', value: 'AtomicBallroom' }
]);
```

### 2. Automated Processing
```javascript
// Process new images with enhanced recognition
annotateImagesWithVision();
```

### 3. Learning from Corrections
1. Edit captions in Google Drive (add structured tags like `#person:Ben`)
2. Run learning function:
```javascript
learnFromCorrections();
```

### 4. Continuous Improvement
The system automatically:
- Stores Vision analysis data for each image
- Learns from your tag corrections
- Improves suggestions over time
- Builds confidence scores for recognition

## Example Results

**Before (Basic AI):**
"Three people in a dance studio"

**After (Hybrid System):**
"Ben and friends practicing ballroom at Atomic Ballroom #person:Ben #location:AtomicBallroom #hobby:danceclasses #photo:group"

**Screenshot Recognition:**
"Spanish lesson progress in Duolingo app #app:Duolingo #hobby:spanish #activity:learning"

## Current Status

✅ **Implemented:**
- Google Vision API integration
- Face detection and analysis
- OCR for screenshot recognition  
- App pattern recognition (Duolingo, LingQ, etc.)
- Learning database system
- Training functions
- Enhanced annotation pipeline

⚠️ **Needs Setup:**
- Enable Cloud Vision API in Google Cloud Console
- Test with actual images
- Train initial face recognition data

🔄 **Next Steps:**
- Test system with recent photos
- Train face recognition on known people
- Refine app/context detection patterns
- Add scheduled learning runs

## Error Handling

**403 Error (Vision API):**
- Enable Cloud Vision API in Google Cloud Console
- Ensure billing is enabled
- Check project permissions

**No faces detected:**
- Ensure image quality is good
- Check if faces are clearly visible
- Try different images for training

**Learning not working:**
- Check if descriptions contain structured tags (`#person:Name`)
- Ensure Vision analysis data exists for images
- Verify knowledge base file is being created/updated

## Cost Considerations

**Google Vision API:**
- Free tier: 1,000 requests/month
- After free tier: ~$1.50 per 1,000 images
- Face detection: Same pricing as general detection

**Claude API:**
- Existing usage for caption generation
- Enhanced prompts may use slightly more tokens

**Storage:**
- Knowledge base stored as JSON file in Google Drive (minimal cost)
- Vision analysis data stored with each image (small overhead)