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