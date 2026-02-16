// backend/src/index.ts
import express from "express";
import mongoose from "mongoose";
import cors from "cors";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
// import nodemailer from 'nodemailer';
import { Resend } from "resend";
dotenv.config();
const app = express();
app.use(express.json());
app.use(cors());

// // Configure email transporter
// const emailUser = process.env.EMAIL_USER || 'your-email@gmail.com';
// const emailPassword = (process.env.EMAIL_APP_PASSWORD || 'your-app-password').replace(/\s/g, ''); // Remove all spaces
// const VOLUNTEER_EMAIL = process.env.VOLUNTEER_EMAIL || 'anuragthakur2102@gmail.com';

// console.log('Email Configuration:');
// console.log('  EMAIL_USER:', emailUser);
// console.log('  EMAIL_APP_PASSWORD:', emailPassword ? `✓ Set (${emailPassword.length} chars)` : '✗ NOT SET');
// console.log('  VOLUNTEER_EMAIL:', VOLUNTEER_EMAIL);

// const emailTransporter = nodemailer.createTransport({
//     service: 'gmail',
//     auth: {
//         user: emailUser,
//         pass: emailPassword
//     }
// });

const resend = new Resend(process.env.RESEND_API_KEY);

interface EmailParams {
  to: string;
  subject: string;
  html: string;
}

const sendEmail = async ({ to, subject, html }: EmailParams) => {
  try {
    const { data, error } = await resend.emails.send({
      from: "Alumni Info <info@alumni.iiitm.ac.in>",
      to: [to],
      subject,
      html,
    });

    // 1. Check for API-level errors (e.g., invalid email, bounced)
    if (error) {
      console.error("Resend API Error:", error);
      return;
    }

    // 2. Success
    console.log("Email sent successfully:", data);
  } catch (err) {
    // 3. Catch unexpected crashes (e.g., network failure)
    console.error("Unexpected System Error:", err);
  }
};

const meetAppDist = path.resolve(__dirname, "../../meet/alumnimeet/dist");

if (fs.existsSync(meetAppDist)) {
  app.use("/alumnimeet", express.static(meetAppDist));
  app.get(/^\/alumnimeet(\/.*)?$/, (_req, res) => {
    res.sendFile(path.join(meetAppDist, "index.html"));
  });
} else {
  console.warn(
    `Meet app build not found at ${meetAppDist}. Run the meet build before serving /alumnimeet.`,
  );
}

// Define Mongoose schema for Alumni
const alumniSchema = new mongoose.Schema({
  serialNo: String,
  name: { type: String, required: true, index: true },
  rollNumber: { type: String, required: true, unique: true, index: true },
  gender: String,
  yearOfEntry: Number,
  yearOfGraduation: Number,
  programName: String,
  specialization: String,
  department: String,
  currentLocationIndia: String,
  currentOverseasLocation: String,
  country: String,
  lastPosition: String,
  lastOrganization: String,
  natureOfJob: String,
  email: String,
  phone: String,
  linkedIn: String,
  twitter: String,
  instagram: String,
  facebook: String,
  hostels: String,
  higherStudies: String,
  startup: String,
  achievements: String,
  collegeClubs: String,
  photoLink: String,
});

// Create indexes for better query performance
// Text index for name and rollNumber search
alumniSchema.index({ name: "text", rollNumber: "text" });
// Compound index for filter operations
alumniSchema.index({
  lastOrganization: 1,
  currentLocationIndia: 1,
  currentOverseasLocation: 1,
  yearOfGraduation: 1,
});

const Alumni = mongoose.model("Alumni", alumniSchema);

// Define schema for update requests
const updateRequestSchema = new mongoose.Schema({
  rollNumber: { type: String, required: true, index: true },
  oldData: { type: mongoose.Schema.Types.Mixed, required: true },
  newData: { type: mongoose.Schema.Types.Mixed, required: true },
  status: {
    type: String,
    enum: ["pending", "approved", "rejected"],
    default: "pending",
    index: true,
  },
  submittedAt: { type: Date, default: Date.now, index: true },
  reviewedAt: { type: Date },
  reviewedBy: { type: String },
  notes: { type: String },
});

const UpdateRequest = mongoose.model("UpdateRequest", updateRequestSchema);

// Connect to MongoDB with retry logic
const MONGO_URL =
  process.env.MONGO_URL || "mongodb://localhost:27017/alumni_db";

let mongoConnected = false;

// Add database name to connection URL if using MongoDB Atlas
const getConnectionUrl = (url: string): string => {
  if (url.includes("mongodb+srv://") && !url.match(/\/[^?]+\?/)) {
    // Insert database name before query parameters
    return url.replace(/\/\?/, "/alumni_db?");
  }
  return url;
};

// Connection options with timeouts and pooling
const mongooseOptions = {
  serverSelectionTimeoutMS: 10000, // 10 seconds
  connectTimeoutMS: 10000,
  socketTimeoutMS: 45000,
  maxPoolSize: 10,
  minPoolSize: 2,
};

// Retry connection with exponential backoff
async function connectWithRetry(retries = 5, delay = 2000): Promise<void> {
  for (let i = 0; i < retries; i++) {
    try {
      // const connectionUrl = getConnectionUrl(MONGO_URL);
      const connectionUrl = MONGO_URL;
      console.log(MONGO_URL);
      await mongoose.connect(connectionUrl, mongooseOptions);
      console.log("MongoDB connected successfully");
      mongoConnected = true;
      return;
    } catch (err) {
      console.error(`MongoDB connection attempt ${i + 1} failed:`, err);
      if (i < retries - 1) {
        const waitTime = delay * Math.pow(2, i);
        console.log(`Retrying in ${waitTime}ms...`);
        await new Promise((resolve) => setTimeout(resolve, waitTime));
      } else {
        console.error("MongoDB connection failed after all retries");
        throw err;
      }
    }
  }
}

// Health check endpoint
app.get("/api/health", (req, res) => {
  const isConnected = mongoose.connection.readyState === 1;
  res.json({
    status: isConnected ? "ok" : "degraded",
    mongoConnected: isConnected,
    connectionState: mongoose.connection.readyState,
  });
});

// Sanitize input to prevent injection attacks
function sanitizeInput(input: string): string {
  return input.trim().replace(/["\\"]/g, "\\$&");
}

function escapeRegex(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildCaseInsensitiveExactRegex(input: string): {
  $regex: string;
  $options: string;
} {
  const escaped = escapeRegex(input.trim());
  return {
    $regex: `^\\s*${escaped}\\s*$`,
    $options: "i",
  };
}

const PROGRAM_SORT_ORDER = [
  "PGDMIT",
  "PGDIT",
  "IPG",
  "IMT",
  "IMG",
  "BCS",
  "BIT",
  "MBA",
  "MTECH",
  "PHD",
  "DSC",
];

// search endpoint -->
app.get("/api/search", async (req, res) => {
  const name = typeof req.query.name === "string" ? req.query.name.trim() : "";
  const rollNumber =
    typeof req.query.rollNumber === "string" ? req.query.rollNumber.trim() : "";
  const lastOrganization =
    typeof req.query.lastOrganization === "string"
      ? req.query.lastOrganization.trim()
      : typeof req.query.company === "string"
        ? req.query.company.trim()
        : "";
  const lastPosition =
    typeof req.query.lastPosition === "string"
      ? req.query.lastPosition.trim()
      : "";
  const collegeClubs =
    typeof req.query.collegeClubs === "string"
      ? req.query.collegeClubs.trim()
      : "";
  const natureOfJob =
    typeof req.query.natureOfJob === "string"
      ? req.query.natureOfJob.trim()
      : "";
  const country =
    typeof req.query.country === "string" ? req.query.country.trim() : "";
  const city = typeof req.query.city === "string" ? req.query.city.trim() : "";
  const yearOfEntry =
    typeof req.query.yearOfEntry === "string"
      ? req.query.yearOfEntry.trim()
      : "";
  const programName =
    typeof req.query.programName === "string"
      ? req.query.programName.trim()
      : "";
  const specialization =
    typeof req.query.specialization === "string"
      ? req.query.specialization.trim()
      : "";
  // Pagination parameters
  const page = Math.max(1, parseInt(req.query.page as string) || 1);
  const limit = Math.min(
    50,
    Math.max(1, parseInt(req.query.limit as string) || 20),
  ); // Max 50 results per page

  try {
    const andConditions: any[] = [];

    if (name) {
      const sanitizedName = escapeRegex(sanitizeInput(name));
      andConditions.push({
        name: {
          $regex: sanitizedName,
          $options: "i",
        },
      });
    }

    if (lastOrganization) {
      const sanitizedCompany = escapeRegex(sanitizeInput(lastOrganization));
      andConditions.push({
        lastOrganization: {
          $regex: sanitizedCompany,
          $options: "i",
        },
      });
    }

    if (lastPosition) {
      const sanitizedLastPosition = escapeRegex(sanitizeInput(lastPosition));
      andConditions.push({
        lastPosition: {
          $regex: sanitizedLastPosition,
          $options: "i",
        },
      });
    }

    if (collegeClubs) {
      const sanitizedCollegeClubs = escapeRegex(sanitizeInput(collegeClubs));
      andConditions.push({
        collegeClubs: {
          $regex: sanitizedCollegeClubs,
          $options: "i",
        },
      });
    }

    if (rollNumber) {
      andConditions.push({
        rollNumber: buildCaseInsensitiveExactRegex(rollNumber),
      });
    }

    if (natureOfJob) {
      andConditions.push({
        natureOfJob: buildCaseInsensitiveExactRegex(natureOfJob),
      });
    }

    if (country) {
      andConditions.push({
        country: buildCaseInsensitiveExactRegex(country),
      });
    }

    if (city) {
      const sanitizedCity = escapeRegex(sanitizeInput(city));
      andConditions.push({
        $or: [
          {
            currentLocationIndia: {
              // The \\b ensures it matches whole words, not partial words
              $regex: `\\b${sanitizedCity}`,
              $options: "i",
            },
          },
          {
            currentOverseasLocation: {
              $regex: `\\b${sanitizedCity}`,
              $options: "i",
            },
          },
        ],
      });
    }

    if (yearOfEntry) {
      const parsedYearOfEntry = parseInt(yearOfEntry);
      if (!isNaN(parsedYearOfEntry)) {
        andConditions.push({ yearOfEntry: parsedYearOfEntry });
      }
    }

    if (programName) {
      andConditions.push({
        programName: buildCaseInsensitiveExactRegex(programName),
      });
    }

    if (specialization) {
      andConditions.push({
        specialization: buildCaseInsensitiveExactRegex(specialization),
      });
    }

    // Build the final query
    const query = andConditions.length > 0 ? { $and: andConditions } : {};

    // If no search parameters provided, return empty result
    if (Object.keys(query).length === 0) {
      res.json({ count: 0, data: [], page, limit, hasMore: false });
      return;
    }

    // Calculate skip for pagination
    const skip = (page - 1) * limit;

    // Project only needed fields to reduce payload size
    const projection: any = {
      serialNo: 1,
      name: 1,
      linkedIn: 1,
      rollNumber: 1,
      department: 1,
      yearOfEntry: 1,
      yearOfGraduation: 1,
      programName: 1,
      specialization: 1,
      country: 1,
      lastPosition: 1,
      natureOfJob: 1,
      collegeClubs: 1,
      lastOrganization: 1,
      currentLocationIndia: 1,
      currentOverseasLocation: 1,
    };

    const programSortBranches = PROGRAM_SORT_ORDER.map((program, index) => ({
      case: {
        $eq: [{ $toUpper: { $ifNull: ["$programName", ""] } }, program],
      },
      then: index + 1,
    }));

    // Execute query with pagination sorted by custom program order, then serialNo ascending
    const results = await Alumni.aggregate([
      { $match: query },
      {
        $addFields: {
          programSortOrder: {
            $switch: {
              branches: programSortBranches,
              default: PROGRAM_SORT_ORDER.length + 1,
            },
          },
          serialNoNumeric: {
            $convert: {
              input: "$serialNo",
              to: "int",
              onError: Number.MAX_SAFE_INTEGER,
              onNull: Number.MAX_SAFE_INTEGER,
            },
          },
          serialNoString: { $ifNull: ["$serialNo", ""] },
        },
      },
      { $sort: { programSortOrder: 1, serialNoNumeric: 1, serialNoString: 1 } },
      { $project: projection },
      { $skip: skip },
      { $limit: limit },
    ]);

    // Get total count for pagination metadata
    const totalCount = await Alumni.countDocuments(query);
    const hasMore = skip + results.length < totalCount;

    const cleanedResults = results;

    res.json({
      count: cleanedResults.length,
      data: cleanedResults,
      page,
      limit,
      totalCount,
      hasMore,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

// Missing alumni endpoint (always restricted to CAREERBREAK/DECEASED)
app.get("/api/missing_alumni", async (req, res) => {
  const yearOfEntry =
    typeof req.query.yearOfEntry === "string"
      ? req.query.yearOfEntry.trim()
      : "";
  const programName =
    typeof req.query.programName === "string"
      ? req.query.programName.trim()
      : "";
  const specialization =
    typeof req.query.specialization === "string"
      ? req.query.specialization.trim()
      : "";

  const page = Math.max(1, parseInt(req.query.page as string) || 1);
  const limit = Math.min(
    50,
    Math.max(1, parseInt(req.query.limit as string) || 20),
  );

  const hasOptionalFilter =
    Boolean(yearOfEntry) || Boolean(programName) || Boolean(specialization);

  if (!hasOptionalFilter) {
    res.json({
      count: 0,
      data: [],
      page,
      limit,
      totalCount: 0,
      hasMore: false,
    });
    return;
  }

  try {
    const andConditions: any[] = [
      { natureOfJob: { $in: ["CAREERBREAK", "DECEASED"] } },
    ];

    if (yearOfEntry) {
      const parsedYearOfEntry = parseInt(yearOfEntry);
      if (!isNaN(parsedYearOfEntry)) {
        andConditions.push({ yearOfEntry: parsedYearOfEntry });
      }
    }

    if (programName) {
      andConditions.push({
        programName: buildCaseInsensitiveExactRegex(programName),
      });
    }

    if (specialization) {
      andConditions.push({
        specialization: buildCaseInsensitiveExactRegex(specialization),
      });
    }

    const query = { $and: andConditions };
    const skip = (page - 1) * limit;

    const projection: any = {
      serialNo: 1,
      name: 1,
      linkedIn: 1,
      rollNumber: 1,
      department: 1,
      yearOfEntry: 1,
      programName: 1,
      specialization: 1,
      lastOrganization: 1,
      currentLocationIndia: 1,
      currentOverseasLocation: 1,
      natureOfJob: 1,
    };

    const results = await Alumni.find(query)
      .select(projection)
      .sort({ yearOfEntry: 1 })
      .skip(skip)
      .limit(limit);

    const totalCount = await Alumni.countDocuments(query);
    const hasMore = skip + results.length < totalCount;

    res.json({
      count: results.length,
      data: results,
      page,
      limit,
      totalCount,
      hasMore,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

// Submit update request endpoint
app.post("/api/update-request", async (req, res) => {
  try {
    const { rollNumber, oldData, newData } = req.body;

    if (!rollNumber || !oldData || !newData) {
      res.status(400).json({ error: "Missing required fields" });
      return;
    }

    // Verify that the alumni exists
    const alumni = await Alumni.findOne({ rollNumber });
    if (!alumni) {
      res.status(404).json({ error: "Alumni not found" });
      return;
    }

    // Create update request
    const updateRequest = new UpdateRequest({
      rollNumber,
      oldData,
      newData,
      status: "pending",
    });

    await updateRequest.save();

    // Send email notification
    try {
      const changedFields = [];
      for (const key in newData) {
        if (JSON.stringify(oldData[key]) !== JSON.stringify(newData[key])) {
          changedFields.push({
            field: key,
            oldValue: oldData[key] || "N/A",
            newValue: newData[key] || "N/A",
          });
        }
      }

      const emailHtml = `
                <h2>New Alumni Update Request</h2>
                <p><strong>Alumni Name:</strong> ${newData.name || oldData.name}</p>
                <p><strong>Roll Number:</strong> ${rollNumber}</p>
                <p><strong>Request ID:</strong> ${updateRequest._id}</p>
                <p><strong>Submitted At:</strong> ${new Date().toLocaleString()}</p>
                
                <h3>Changed Fields (${changedFields.length}):</h3>
                <table border="1" cellpadding="8" cellspacing="0" style="border-collapse: collapse; width: 100%;">
                    <thead>
                        <tr style="background-color: #f0f0f0;">
                            <th>Field</th>
                            <th>Previous Value</th>
                            <th>New Value</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${changedFields
                          .map(
                            (change) => `
                            <tr>
                                <td><strong>${change.field}</strong></td>
                                <td style="color: #d32f2f;">${change.oldValue}</td>
                                <td style="color: #388e3c;">${change.newValue}</td>
                            </tr>
                        `,
                          )
                          .join("")}
                    </tbody>
                </table>
                
                <p style="margin-top: 20px;">
                    <a href="${process.env.FRONTEND_URL || "http://localhost:5173"}/volunteer-portal-secret" 
                       style="background-color: #4CAF50; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px;">
                        Review in Volunteer Portal
                    </a>
                </p>
            `;

      // await emailTransporter.sendMail({
      //     from: process.env.EMAIL_USER || 'Alumni Network <noreply@alumni.com>',
      //     to: VOLUNTEER_EMAIL,
      //     subject: `Alumni Update Request - ${newData.name || oldData.name} (${rollNumber})`,
      //     html: emailHtml
      // });
      await sendEmail({
        to: "alumninet@iiitm.ac.in",
        subject: `Alumni Update Request - ${newData.name || oldData.name} (${rollNumber})`,
        html: emailHtml,
      });
      // console.log('✓ Email notification sent successfully to', VOLUNTEER_EMAIL);
    } catch (emailError: any) {
      console.error("✗ Failed to send email notification");
      console.error("  Error code:", emailError.code);
      console.error("  Error message:", emailError.message);
      console.error("  Full error:", emailError);
      // Don't fail the request if email fails
    }

    res.json({
      success: true,
      message: "Update request submitted successfully",
      requestId: updateRequest._id,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

// Secret volunteer portal endpoints
const VOLUNTEER_SECRET =
  process.env.VOLUNTEER_SECRET || "change-this-secret-key-in-production";

console.log(
  "Backend Started - VOLUNTEER_SECRET loaded:",
  VOLUNTEER_SECRET ? `✓ (${VOLUNTEER_SECRET.length} chars)` : "✗ NOT FOUND",
);

// Middleware to verify volunteer access
const verifyVolunteer = (req: any, res: any, next: any) => {
  const authHeader = req.headers.authorization;
  const expectedAuth = `Bearer ${VOLUNTEER_SECRET}`;

  console.log("Volunteer auth attempt:");
  console.log(
    "  Received header:",
    authHeader
      ? `Bearer ${authHeader.replace("Bearer ", "").substring(0, 5)}...`
      : "NONE",
  );
  console.log("  Expected:", `Bearer ${VOLUNTEER_SECRET.substring(0, 5)}...`);
  console.log("  Match:", authHeader === expectedAuth ? "✓ YES" : "✗ NO");

  if (!authHeader || authHeader !== expectedAuth) {
    console.log("  → Auth FAILED - returning 401");
    res.status(401).json({ error: "Unauthorized - Invalid secret key" });
    return;
  }
  console.log("  → Auth SUCCESS");
  next();
};

// Get all pending update requests (volunteer only)
app.get("/api/volunteer/update-requests", verifyVolunteer, async (req, res) => {
  try {
    const status = (req.query.status as string) || "pending";
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(
      50,
      Math.max(1, parseInt(req.query.limit as string) || 20),
    );
    const skip = (page - 1) * limit;

    const query = status === "all" ? {} : { status };

    const requests = await UpdateRequest.find(query)
      .sort({ submittedAt: -1 })
      .skip(skip)
      .limit(limit);

    const totalCount = await UpdateRequest.countDocuments(query);
    const hasMore = skip + requests.length < totalCount;

    res.json({
      data: requests,
      page,
      limit,
      totalCount,
      hasMore,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

// Approve update request (volunteer only)
app.post(
  "/api/volunteer/update-requests/:id/approve",
  verifyVolunteer,
  async (req, res) => {
    try {
      const { id } = req.params;
      const { notes } = req.body;

      const updateRequest = await UpdateRequest.findById(id);
      if (!updateRequest) {
        res.status(404).json({ error: "Update request not found" });
        return;
      }

      if (updateRequest.status !== "pending") {
        res.status(400).json({ error: "Update request already processed" });
        return;
      }

      // Update the alumni record
      const alumni = await Alumni.findOne({
        rollNumber: updateRequest.rollNumber,
      });
      if (!alumni) {
        res.status(404).json({ error: "Alumni not found" });
        return;
      }

      // Apply the updates
      Object.assign(alumni, updateRequest.newData);
      await alumni.save();

      // Update the request status
      updateRequest.status = "approved";
      updateRequest.reviewedAt = new Date();
      updateRequest.notes = notes;
      await updateRequest.save();

      res.json({
        success: true,
        message: "Update request approved and applied",
        alumni,
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Server error" });
    }
  },
);

// Reject update request (volunteer only)
app.post(
  "/api/volunteer/update-requests/:id/reject",
  verifyVolunteer,
  async (req, res) => {
    try {
      const { id } = req.params;
      const { notes } = req.body;

      const updateRequest = await UpdateRequest.findById(id);
      if (!updateRequest) {
        res.status(404).json({ error: "Update request not found" });
        return;
      }

      if (updateRequest.status !== "pending") {
        res.status(400).json({ error: "Update request already processed" });
        return;
      }

      updateRequest.status = "rejected";
      updateRequest.reviewedAt = new Date();
      updateRequest.notes = notes;
      await updateRequest.save();

      res.json({
        success: true,
        message: "Update request rejected",
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Server error" });
    }
  },
);

// Start server only after MongoDB connection is established
async function startServer() {
  try {
    // Connect to MongoDB first
    await connectWithRetry();

    const PORT = parseInt(process.env.PORT || "3001");
    const server = app.listen(PORT, "0.0.0.0", () => {
      console.log(`Server running on port ${PORT}`);
      console.log(
        `MongoDB connection state: ${mongoose.connection.readyState}`,
      );
    });

    server.on("error", (err) => {
      console.error("Server error:", err);
    });

    // Graceful shutdown
    process.on("SIGTERM", async () => {
      console.log("SIGTERM received, closing server gracefully...");
      server.close(() => {
        console.log("Server closed");
      });
      await mongoose.connection.close();
      console.log("MongoDB connection closed");
      process.exit(0);
    });

    process.on("SIGINT", async () => {
      console.log("SIGINT received, closing server gracefully...");
      server.close(() => {
        console.log("Server closed");
      });
      await mongoose.connection.close();
      console.log("MongoDB connection closed");
      process.exit(0);
    });
  } catch (error) {
    console.error("Failed to start server:", error);
    process.exit(1);
  }
}

// Start the server
startServer();
