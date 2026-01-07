require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { MongoClient, ServerApiVersion } = require('mongodb');
const admin = require('firebase-admin');

const app = express();
const port = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

// --- Firebase Admin Setup ---
try {
  const serviceAccount = require('./serviceAccountKey.json');
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
  console.log('Firebase Admin Initialized');
} catch (error) {
  console.warn('WARNING: serviceAccountKey.json not found. Auth verification will fail.');
}

// --- MongoDB Config ---
const uri = process.env.MONGO_URI;
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});

let db; // Global DB reference

async function run() {
  try {
    // Connect the client to the server
    await client.connect();
    // Send a ping to confirm a successful connection (optional but good for log)
    await client.db("admin").command({ ping: 1 });
    console.log("Pinged your deployment. You successfully connected to MongoDB!");

    // Set the database to use
    db = client.db("job-candidate-db");

    // Start Server only after DB connection
    app.listen(port, () => {
      console.log(`Job Candidate Server is running on port: ${port}`);
    });

  } catch (error) {
    console.error("MongoDB Connection Error:", error);
  }
}
run().catch(console.dir);


// --- Middlewares ---

const verifyToken = async (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) {
    return res.status(401).send('Unauthorized: No token provided');
  }

  // --- DEV BYPASS FOR TESTING ---
  if (token === 'DEV_TOKEN') {
    req.user = { uid: 'test-uid-123', email: 'admin@test.com' }; // Matches your seed user
    return next();
  }
  // -----------------------------

  try {
    const decodedToken = await admin.auth().verifyIdToken(token);
    req.user = decodedToken;
    next();
  } catch (error) {
    console.error('Auth Verify Error:', error.message);
    res.status(401).send('Unauthorized: Invalid token');
  }
};

const verifyRole = (allowedRoles) => {
  return async (req, res, next) => {
    try {
      if (!req.user || !req.user.uid) return res.status(401).send('Unauthorized');

      const usersCollection = db.collection('users');
      const user = await usersCollection.findOne({ uid: req.user.uid });

      if (!user) {
        return res.status(404).send('User role not found in database');
      }

      if (allowedRoles.includes(user.role)) {
        req.dbUser = user;
        next();
      } else {
        res.status(403).send('Forbidden: Insufficient Permissions');
      }
    } catch (error) {
      console.error('Role Check Error:', error);
      res.status(500).send('Internal Server Error');
    }
  };
};

// --- Routes ---

app.get('/', (req, res) => {
  res.send('Job Candidate Server is running');
});

// Test Auth Route
app.get('/api/test-auth', verifyToken, (req, res) => {
  res.json({ message: 'Authenticated', user: req.user });
});

// Helper to Create User with Role (For Testing)
// This enables you to insert a user with a specific role into the 'users' collection
// Helper to Create User with Role (For Testing)
// This enables you to insert a user with a specific role into the 'users' collection
app.post('/api/users/register-role', async (req, res) => {
  try {
    const { uid, email, role } = req.body;
    if (!uid || !role) return res.status(400).send('UID and Role required');

    const usersCollection = db.collection('users');

    // Check if exists
    const existingUser = await usersCollection.findOne({ uid });
    if (existingUser) {
      await usersCollection.updateOne({ uid }, { $set: { role, email } });
      res.json({ message: 'User updated', uid, role });
    } else {
      await usersCollection.insertOne({ uid, email, role: role || 'candidate' });
      res.json({ message: 'User registered', uid, role });
    }
  } catch (error) {
    res.status(500).send(error.message);
  }
});

// --- File Upload Setup (Multer) ---
// const multer = require('multer'); // Ensure this is required at top if not global, but I'll assume global fix later or inline here
const multer = require('multer');
const xlsx = require('xlsx');
const fs = require('fs');

// Ensure uploads dir
if (!fs.existsSync('uploads')) {
  fs.mkdirSync('uploads');
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'uploads/');
  },
  filename: (req, file, cb) => {
    cb(null, `candidates-${Date.now()}-${file.originalname}`);
  }
});
const upload = multer({ storage: storage });


// --- Candidate Routes ---

// 1. Upload Candidates (Excel) - Admin/Staff Only
app.post('/api/candidates/upload', verifyToken, verifyRole(['admin', 'staff']), upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).send('No file uploaded');
  }

  try {
    const filePath = req.file.path;
    const workbook = xlsx.readFile(filePath);
    const sheetName = workbook.SheetNames[0];
    const data = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName]);

    const candidatesCollection = db.collection('candidates');
    const processed = [];
    const errors = [];

    for (const item of data) {
      // Validation
      if (!item.name || !item.email || !item.phone || !item.experience_years || !item.age) {
        errors.push(`Skipped: Missing fields for ${item.name || 'Unknown'}`);
        continue;
      }

      // Check Duplicate Email
      const existing = await candidatesCollection.findOne({ email: item.email });
      if (existing) {
        errors.push(`Skipped: Email ${item.email} already exists`);
        continue;
      }

      // Prepare Object
      const candidate = {
        name: item.name,
        email: item.email,
        phone: String(item.phone),
        experience_years: Number(item.experience_years),
        previous_experience: item.previous_experience || [], // Expecting JSON or simple text, verify format if needed
        age: Number(item.age),
        status: 'pending', // Default status
        createdBy: req.user.uid,
        createdAt: new Date()
      };

      processed.push(candidate);
    }

    if (processed.length > 0) {
      await candidatesCollection.insertMany(processed);
    }

    // Cleanup
    fs.unlinkSync(filePath);

    res.json({
      message: 'File processed',
      added: processed.length,
      errors: errors
    });

  } catch (error) {
    console.error('Upload Error:', error);
    res.status(500).send('Error processing file');
  }
});

// 2. View All Candidates - Admin/Staff Only
app.get('/api/candidates', verifyToken, verifyRole(['admin', 'staff']), async (req, res) => {
  try {
    const candidatesCollection = db.collection('candidates');
    // Sort by Newest First
    const candidates = await candidatesCollection.find().sort({ createdAt: -1 }).toArray();
    res.json(candidates);
  } catch (error) {
    console.error('Fetch Error:', error);
    res.status(500).send('Error fetching candidates');
  }
});

// 3. View My Profile - Candidate Only
app.get('/api/candidates/me', verifyToken, verifyRole(['candidate']), async (req, res) => {
  try {
    // We assume the candidate's email corresponds to their Auth email
    // In a real app, you might link UID directly if they registered themselves.
    // Here, we look up by email since Staff uploads them by email.
    const email = req.user.email;
    if (!email) return res.status(400).send('User email not found in token');

    const candidatesCollection = db.collection('candidates');
    const candidate = await candidatesCollection.findOne({ email: email });

    if (!candidate) return res.status(404).json({ message: 'Profile not found' });
    res.json(candidate);

  } catch (error) {
    res.status(500).send('Error fetching profile');
  }
});

// 4. Edit Candidate - Admin Only
app.put('/api/candidates/:id', verifyToken, verifyRole(['admin']), async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;
    const { ObjectId } = require('mongodb');

    // Prevent updating immutable fields if necessary (optional)
    delete updates._id;
    delete updates.email; // Usually bad to change email as it's identity

    const candidatesCollection = db.collection('candidates');
    const result = await candidatesCollection.findOneAndUpdate(
      { _id: new ObjectId(id) },
      { $set: updates },
      { returnDocument: 'after' }
    );

    if (!result) return res.status(404).send('Candidate not found');
    res.json(result);

  } catch (error) {
    console.error('Update Error:', error);
    res.status(500).send('Error updating candidate');
  }
});

// 5. Delete Candidate - Admin Only
app.delete('/api/candidates/:id', verifyToken, verifyRole(['admin']), async (req, res) => {
  try {
    const { id } = req.params;
    const { ObjectId } = require('mongodb');

    const candidatesCollection = db.collection('candidates');
    const result = await candidatesCollection.deleteOne({ _id: new ObjectId(id) });

    if (result.deletedCount === 0) return res.status(404).send('Candidate not found');
    res.json({ message: 'Candidate deleted' });

  } catch (error) {
    console.error('Delete Error:', error);
    res.status(500).send('Error deleting candidate');
  }
});

// 6. Schedule Interview - Admin/Staff Only
app.post('/api/interviews', verifyToken, verifyRole(['admin', 'staff']), async (req, res) => {
  try {
    const { candidateId, date, time, type } = req.body; // type: Technical, HR, etc.
    const { ObjectId } = require('mongodb');

    if (!candidateId || !date || !time) {
      return res.status(400).send('Missing required fields');
    }

    const interview = {
      candidateId: new ObjectId(candidateId),
      date,
      time,
      type: type || 'General',
      status: 'Scheduled',
      scheduledBy: req.user.uid,
      createdAt: new Date()
    };

    const interviewsCollection = db.collection('interviews');
    const result = await interviewsCollection.insertOne(interview);

    // Optionally update candidate status
    await db.collection('candidates').updateOne(
      { _id: new ObjectId(candidateId) },
      { $set: { status: 'Interview Scheduled' } }
    );

    res.status(201).json({ message: 'Interview scheduled', id: result.insertedId });

  } catch (error) {
    console.error('Schedule Error:', error);
    res.status(500).send('Error scheduling interview');
  }
});

// 7. View Interviews - Admin/Staff Only
app.get('/api/interviews', verifyToken, verifyRole(['admin', 'staff']), async (req, res) => {
  try {
    const interviewsCollection = db.collection('interviews');
    // Join with candidates to get candidate names
    const interviews = await interviewsCollection.aggregate([
      {
        $lookup: {
          from: 'candidates',
          localField: 'candidateId',
          foreignField: '_id',
          as: 'candidate'
        }
      },
      { $unwind: '$candidate' }, // Convert array to object
      { $sort: { date: 1, time: 1 } } // Sort by upcoming
    ]).toArray();

    res.json(interviews);

  } catch (error) {
    console.error('Fetch Interviews Error:', error);
    res.status(500).send('Error fetching interviews');
  }
});

// 8. Update Interview Status - Admin/Staff Only
app.put('/api/interviews/:id/status', verifyToken, verifyRole(['admin', 'staff']), async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body; // e.g., 'Completed', 'Cancelled'
    const { ObjectId } = require('mongodb');

    const result = await db.collection('interviews').updateOne(
      { _id: new ObjectId(id) },
      { $set: { status } }
    );

    if (result.matchedCount === 0) return res.status(404).send('Interview not found');
    res.json({ message: 'Status updated' });

  } catch (error) {
    res.status(500).send('Error updating interview status');
  }
});