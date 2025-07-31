const express = require("express");
const mysql = require("mysql2");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const cors = require("cors");
require("dotenv").config();

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const JWT_SECRET = process.env.JWT_SECRET || "your_jwt_secret";
const path = require("path");

// Serve frontend static files
app.use(express.static(path.join(__dirname, '../frontend')));

// API routes (like /register, /login)
app.use(express.json());
// your login/register logic here...

// When user visits "/", serve login.html
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "frontend", "login.html"));
});

// ✅ Database Connection
const db = mysql.createConnection({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT, // Railway gives you a custom port
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME
});

db.connect((err) => {
    if (err) {
        console.error("❌ Database Connection Failed:", err.message);
        process.exit(1);
    }
    console.log("✅ Connected to MySQL Database");
});



// ✅ User Registration
app.post("/register", async (req, res) => {
    const { name, email, password, role } = req.body;
    if (!name || !email || !password || !role) {
        return res.status(400).json({ message: "All fields are required!" });
    }
    db.query("SELECT * FROM users WHERE email = ?", [email], async (err, results) => {
        if (err) return res.status(500).json({ message: "Database error", error: err });
        if (results.length > 0) {
            return res.status(400).json({ message: "Email already exists!" });
        }
        try {
            const salt = await bcrypt.genSalt(10);
            const hashedPassword = await bcrypt.hash(password, salt);
            db.query("INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, ?)",
                [name, email, hashedPassword, role],
                (err) => {
                    if (err) return res.status(500).json({ message: "Database error", error: err });
                    res.status(201).json({ message: "User registered successfully!" });
                }
            );
        } catch (hashError) {
            res.status(500).json({ message: "Error hashing password", error: hashError.message });
        }
    });
});

app.post("/login", async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) {
        return res.status(400).json({ message: "Email and password are required!" });
    }

    db.query("SELECT * FROM users WHERE email = ?", [email], async (err, results) => {
        if (err) return res.status(500).json({ message: "Database error", error: err });
        if (results.length === 0) {
            return res.status(400).json({ message: "Invalid Email or Password!" });
        }

        const user = results[0];

        try {
            const isMatch = await bcrypt.compare(password, user.password);
            if (!isMatch) {
                return res.status(400).json({ message: "Invalid Email or Password!" });
            }

            // ✅ Generate the JWT token **only once**
            const token = jwt.sign(
                { id: user.id, name: user.name, email: user.email, role: user.role },
                JWT_SECRET,
                { expiresIn: "1h" }
            );

            console.log("✅ Token Generated:", token);

            // ✅ Send only one response
            return res.json({ message: "Login successful!", token, name: user.name, role: user.role });

        } catch (error) {
            return res.status(500).json({ message: "Error processing login", error: error.message });
        }
    });
});
// ✅ Middleware to Verify Token
function verifyToken(req, res, next) {
    const token = req.header("Authorization");
    if (!token) return res.status(401).json({ message: "Access Denied! No token provided." });
    try {
        const actualToken = token.startsWith("Bearer ") ? token.split(" ")[1] : token;
        const verified = jwt.verify(actualToken, JWT_SECRET);
        req.user = verified;
        next();
    } catch (error) {
        res.status(400).json({ message: "Invalid Token!", error: error.message });
    }
}
    // ✅ Create Event
    app.post("/create-event", verifyToken, async (req, res) => {
        try {
            const { event_name, date_time, venue, description, max_students, total_budget } = req.body;
            const organizer_id = req.user.id;
    
            if (!event_name || !date_time || !venue || !max_students || !total_budget) {
                return res.status(400).json({ message: "All fields are required" });
            }
    
            // Step 1: Check if a similar event already exists
            const checkSql = `
                SELECT 1 FROM events
                WHERE organizer_id = ?
                AND event_name = ?
                AND status IN (?, ?)
                AND date_time >= NOW()
            `;
            const checkValues = [organizer_id, event_name, 'approved', 'pending'];
    
            db.query(checkSql, checkValues, (checkErr, checkResults) => {
                if (checkErr) {
                    console.error("Database Error (Checking Duplicate):", checkErr.sqlMessage || checkErr);
                    return res.status(500).json({ message: "Database error during duplicate check", error: checkErr.sqlMessage || checkErr });
                }
    
                if (checkResults.length > 0) {
                    // Duplicate event exists
                    return res.status(400).json({ message: "Event Name already exists." });
                }
    
                // Step 2: If no duplicate, insert new event
                const insertSql = `
                    INSERT INTO events (organizer_id, event_name, date_time, venue, description, max_students, total_budget, status) 
                    VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')
                `;
                const insertValues = [organizer_id, event_name, date_time, venue, description, max_students, total_budget];
    
                db.query(insertSql, insertValues, (insertErr, insertResult) => {
                    if (insertErr) {
                        console.error("Database Error (Inserting Event):", insertErr.sqlMessage || insertErr);
                        return res.status(500).json({ message: "Database error during event creation", error: insertErr.sqlMessage || insertErr });
                    }
                    res.json({ message: "Event created successfully", eventId: insertResult.insertId });
                });
            });
        } catch (error) {
            console.error("Server Error:", error.message);
            res.status(500).json({ message: "Internal Server Error", error: error.message });
        }
    });


    app.get("/organizer-pending-events", verifyToken, (req, res) => {
        const userId = req.user.id; // Get organizer's ID from JWT token
        const currentDateTime = new Date().toISOString().slice(0, 19).replace("T", " "); // Get current datetime in MySQL format
        const query = `
            SELECT id, event_name, date_time, venue, description, max_students, total_budget, created_at, status 
            FROM events 
            WHERE organizer_id = ? AND status = 'pending' 
            ORDER BY created_at DESC
        `;

        db.query(query, [userId], (err, results) => {
            if (err) {
                console.error("Database Error:", err.message);
                return res.status(500).json({ error: "Database error" });
            }

            res.json(results); // Send the pending events back to the frontend
        });
    });


    // ✅ Get Pending Events (For Admin)


    // ✅ Approve Event (Change Status to Approved)
    app.put("/approve-event/:id", verifyToken, (req, res) => {
        if (req.user.role !== "admin") return res.status(403).json({ message: "Access Denied!" });

        const eventId = req.params.id;
        db.query(
            `UPDATE events SET status = 'approved' WHERE id = ?`, 
            [eventId], 
            (err, result) => {
                if (err) return res.status(500).json({ message: "Error updating event", error: err });
                res.json({ message: "Event approved successfully!" });
            }
        );
    });


    
    // ✅ Deny Event (Mark as Rejected with reason)
app.put("/deny-event/:id", verifyToken, (req, res) => {
    if (req.user.role !== "admin") return res.status(403).json({ message: "Access Denied!" });

    const eventId = req.params.id;
    const { reason } = req.body; // Get reason from request body

    db.query(
        `UPDATE events SET status = 'rejected', rejection_reason = ? WHERE id = ?`, 
        [reason, eventId], 
        (err, result) => {
            if (err) return res.status(500).json({ message: "Error denying event", error: err });
            res.json({ message: "Event denied successfully!" });
        }
    );
});




    app.get("/my-approved-events", verifyToken, (req, res) => { 
        const organizerId = req.user.id;
    
        db.query(
            `SELECT 
                e.*, 
                (SELECT COUNT(*) FROM registrations WHERE event_id = e.id AND status = 'Registered') AS registered_count
            FROM events e 
            WHERE e.organizer_id = ? 
            AND e.status = 'approved' 
            ORDER BY e.created_at DESC`,
            [organizerId],
            (err, results) => {
                if (err) return res.status(500).json({ message: "Database error", error: err });
                res.json(results);
            }
        );
    }); 
    app.get("/approved-events", async (req, res) => {
        try {
            

            // Fetch only upcoming events (current date or future)
            const query = `
                SELECT 
                events.*, 
                users.name AS organizer_name, 
                users.email AS organizer_email,
                (SELECT COUNT(*) FROM registrations WHERE event_id = events.id AND status = 'Registered') AS registered_count
            FROM events 
            JOIN users ON events.organizer_id = users.id
            WHERE events.status = 'approved' 
            AND events.date_time >= NOW()
            ORDER BY events.created_at DESC
            `;

            const [rows] = await db.promise().query(query);
            

            res.json(rows);  
        } catch (error) {
            console.error("❌ Database Error:", error);
            res.status(500).json({ message: "Internal Server Error" });
        }
    });



    app.post("/register-event", verifyToken, async (req, res) => {
        const userId = req.user.id;
        const { eventId } = req.body;

        if (!userId || !eventId) {
            return res.status(400).json({ message: "Missing userId or eventId" });
        }

        try {
            // Retrieve student details
            const [userResult] = await db.promise().execute(
                "SELECT name AS student_name, email AS email_id FROM users WHERE id = ?",
                [userId]
            );

            if (userResult.length === 0) {
                return res.status(404).json({ message: "User not found" });
            }

            const { student_name, email_id } = userResult[0];

            // Retrieve event details and count only "Registered" users
            const [eventResult] = await db.promise().execute(
                `SELECT event_name, max_students, 
                        (SELECT COUNT(*) FROM registrations WHERE event_id = ? AND status = 'Registered') AS current_registrations 
                FROM events WHERE id = ?`,
                [eventId, eventId]
            );

            if (eventResult.length === 0) {
                return res.status(404).json({ message: "Event not found" });
            }

            const { event_name, max_students, current_registrations } = eventResult[0];

            // Check if event is full
            if (current_registrations >= max_students) {
                return res.status(400).json({ message: "Registrations full" });
            }

            // Register the user
            const [result] = await db.promise().execute(
                "INSERT INTO registrations (user_id, event_id, student_name, email_id, event_name, status) VALUES (?, ?, ?, ?, ?, 'Registered')",
                [userId, eventId, student_name, email_id, event_name]
            );

            res.json({
                message: "Registration successful",
                registrationId: result.insertId,
                student_name,
                email_id,
                event_name
            });

        } catch (error) {
            console.error("Database query error:", error);
            res.status(500).json({ message: "Database query error", error: error.message });
        }
    });




    app.get("/my-registrations", verifyToken, async (req, res) => {
        const userId = req.user.id;

        try {
            const [registrations] = await db.promise().execute(
                "SELECT event_id FROM registrations WHERE user_id = ? AND status = 'registered'",
                [userId]
            );

            res.json(registrations);
        } catch (error) {
            console.error("Database query error:", error);
            res.status(500).json({ message: "Database query error", error: error.message });
        }
    });
    app.post("/cancel-registration", verifyToken, async (req, res) => {
        const userId = req.user.id;
        const { eventId } = req.body;

        if (!userId || !eventId) {
            return res.status(400).json({ message: "Missing userId or eventId" });
        }

        try {
            // Update status to 'Cancelled' in registrations table
            await db.promise().execute(
                "UPDATE registrations SET status = 'Cancelled' WHERE user_id = ? AND event_id = ?",
                [userId, eventId]
            );

            res.json({ message: "Registration cancelled successfully" });
        } catch (error) {
            console.error("Database error:", error);
            res.status(500).json({ message: "Database error", error: error.message });
        }
    });

    app.get("/event/:eventId/registrations", async (req, res) => {
        try {
            const { eventId } = req.params;
            const [students] = await db.promise().query(
                `SELECT r.user_id, r.student_name, u.email, r.registered_at 
                FROM registrations r
                JOIN users u ON r.user_id = u.id
                WHERE r.event_id = ? AND r.status = 'registered'`,
                [eventId]
            );

            res.json(students);
        } catch (error) {
            console.error("Error fetching registrations:", error);
            res.status(500).json({ error: "Internal server error" });
        }
    });

    app.get("/event/:id", async (req, res) => {
        const eventId = parseInt(req.params.id, 10);  // ✅ Convert to integer

        try {
            if (isNaN(eventId)) {
                return res.status(400).json({ message: "Invalid event ID" });
            }

            const [events] = await db.promise().query("SELECT * FROM events WHERE id = ?", [eventId]); // ✅ Use `.promise().query()`

            if (events.length === 0) {
                return res.status(404).json({ message: "Event not found" });
            }

            res.json(events[0]);  // ✅ Send first event object
        } catch (error) {
            console.error("Server Error:", error);
            res.status(500).json({ message: "Internal Server Error", error: error.message });
        }
    });
    // Add this endpoint to server.js
    app.get("/organizer-rejected-events", verifyToken, (req, res) => {
        const organizerId = req.user.id;
        
        db.query(
            `SELECT * FROM events 
             WHERE organizer_id = ? AND status = 'rejected'
             ORDER BY created_at DESC`,
            [organizerId],
            (err, results) => {
                if (err) return res.status(500).json({ message: "Database error", error: err });
                res.json(results);
            }
        );
    });
    // ✅ Add Expense Route
    app.post("/add-expense", (req, res) => {
        const { event_id, category, actual_spent } = req.body;

        if (!event_id || !category || actual_spent == null) {
            console.error("Missing required fields:", req.body);
            return res.status(400).json({ error: "All fields are required" });
        }

        // ✅ Fetch total_budget from `events` and the last `total_amount_spent` for event_id
        const budgetQuery = `
            SELECT e.total_budget, 
                COALESCE((SELECT total_amount_spent FROM expenses WHERE event_id = ? ORDER BY id DESC LIMIT 1), NULL) AS lastTotalSpent
            FROM events e 
            WHERE e.id = ?`;

        db.query(budgetQuery, [event_id, event_id], (err, results) => {
            if (err) {
                console.error("Database error in SELECT:", err);
                return res.status(500).json({ error: "Database error in SELECT" });
            }

            if (results.length === 0) {
                return res.status(404).json({ error: "Event not found" });
            }
            let totalBudget = results[0].total_budget || 0;
            let lastTotalSpent = results[0].lastTotalSpent !== null ? parseFloat(results[0].lastTotalSpent) : 0;
    let currentActualSpent = parseFloat(actual_spent) || 0;

    // ✅ Ensure lastTotalSpent and currentActualSpent are numbers
    if (isNaN(lastTotalSpent)) lastTotalSpent = 0;
    if (isNaN(currentActualSpent)) currentActualSpent = 0;

    // ✅ Now safely calculate totalAmountSpent
    let totalAmountSpent = lastTotalSpent + currentActualSpent;
    let remainingBudget = parseFloat(totalBudget) - totalAmountSpent;

            // ✅ Insert the expense into `expenses` table
            const insertQuery = `
                INSERT INTO expenses (event_id, category, actual_spent, total_budget, total_amount_spent) 
                VALUES (?, ?, ?, ?, ?)`;

            db.query(insertQuery, [event_id, category, actual_spent, totalBudget, totalAmountSpent], (err, result) => {
                if (err) {
                    console.error("Database error in INSERT:", err);
                    return res.status(500).json({ error: "Failed to add expense" });
                }

                
                res.json({ 
                    success: true, 
                    message: "Expense added successfully!", 
                    totalAmountSpent, 
                    remainingBudget 
                });
            });
        });
    });
    app.get('/expenses/:eventId', async (req, res) => {
        try {
            const eventId = req.params.eventId;
            

            if (!eventId || isNaN(eventId)) {
                return res.status(400).json({ error: "Invalid event ID" });
            }

            const sql = 'SELECT * FROM expenses WHERE event_id = ?';

            // Use db.query() instead of db.execute() (depends on your MySQL library)
            db.query(sql, [eventId], (err, results) => {
                if (err) {
                    console.error("Database query error:", err);
                    return res.status(500).json({ error: "Database error", details: err.message });
                }

                if (!Array.isArray(results)) {
                    console.error("Query result is not iterable:", results);
                    return res.status(500).json({ error: "Unexpected database response format" });
                }

                if (results.length === 0) {
                    console.log(`No expenses found for event ID: ${eventId}`);
                    return res.json([]); // Return empty array
                }

            
                res.json(results);
            });
        } catch (error) {
            console.error("Error fetching expenses:", error.message);
            res.status(500).json({ error: "Internal Server Error", details: error.message });
        }
    });
    app.get("/expenses/totals/:eventId", async (req, res) => {
        try {
            const { eventId } = req.params;

            // Validate eventId
            if (!eventId || isNaN(eventId)) {
                return res.status(400).json({ error: "Invalid event ID" });
            }

            // Fetch total budget and actual expenses
            const [rows] = await db.promise().query(`
                SELECT 
                    COALESCE(events.total_budget, 0) AS totalBudget, 
                    COALESCE(SUM(expenses.actual_spent), 0) AS totalActual 
                FROM events 
                LEFT JOIN expenses ON events.id = expenses.event_id
                WHERE events.id = ?
                GROUP BY events.id, events.total_budget
            `, [eventId]);

            // If no event is found, return 404
            if (!rows || rows.length === 0) {
                return res.status(404).json({ error: "Event not found" });
            }

            // Extract data and calculate remaining budget
            const { totalBudget, totalActual } = rows[0];
            const remainingBudget = totalBudget - totalActual;

            res.json({ totalBudget, totalActual, remainingBudget });

        } catch (error) {
            console.error("Error fetching expense totals:", error);
            res.status(500).json({
                error: "Server error",
                details: process.env.NODE_ENV === "development" ? error.message : undefined
            });
        }
    });

    app.delete("/delete-expense/:id", (req, res) => {
        const { id } = req.params;

        const deleteQuery = `DELETE FROM expenses WHERE id = ?`;
        db.query(deleteQuery, [id], (err, result) => {
            if (err) {
                console.error("Database error in DELETE:", err);
                return res.status(500).json({ error: "Failed to delete expense" });
            }
            if (result.affectedRows === 0) {
                return res.status(404).json({ error: "Expense not found" });
            }
            res.json({ success: true, message: "Expense deleted successfully!" });
        });
    });

    // ✅ Get All Events
    app.get("/events", verifyToken, (req, res) => {
        db.query(`SELECT e.*, u.name AS organizer_name FROM events e JOIN users u ON e.organizer_id = u.id ORDER BY e.created_at DESC`, (err, results) => {
            if (err) return res.status(500).json({ message: "Database error", error: err });
            res.json(results);
        });
    });

    // ✅ Get Pending Events (Only Admin)
    app.get("/pending-events", verifyToken, (req, res) => {
        if (req.user.role !== "admin") return res.status(403).json({ message: "Access Denied!" });

        db.query(`SELECT e.*, u.name AS organizer_name, u.email AS organizer_email FROM events e JOIN users u ON e.organizer_id = u.id WHERE e.status = 'pending' ORDER BY e.created_at DESC`, (err, results) => {
            if (err) return res.status(500).json({ message: "Database error", error: err });
            res.json(results);
        });
    });

    // ✅ Update Event Status (Only Admin)
    app.post("/update-event-status", verifyToken, (req, res) => {
        if (req.user.role !== "admin") return res.status(403).json({ message: "Access Denied!" });

        const { event_id, status } = req.body;
        if (!["approved", "rejected"].includes(status)) return res.status(400).json({ message: "Invalid status." });

        db.query("UPDATE events SET status = ? WHERE id = ?", [status, event_id], (err) => {
            if (err) return res.status(500).json({ message: "Database error", error: err });
            res.json({ message: `Event has been ${status}.` });
        });
    });

    // ✅ Get Event by ID
    app.get("/get-event/:id", verifyToken, (req, res) => {
        db.query("SELECT * FROM events WHERE id = ?", [req.params.id], (err, result) => {
            if (err) return res.status(500).json({ error: err.message });
            if (result.length === 0) return res.status(404).json({ message: "Event not found" });
            res.json(result[0]);
        });
    });

    app.put("/update-event/:id", verifyToken, (req, res) => {
        // First check if the event is pending
        db.query("SELECT status FROM events WHERE id = ?", [req.params.id], (err, results) => {
            if (err) return res.status(500).json({ error: err.message });
            if (results.length === 0) return res.status(404).json({ message: "Event not found" });
            
            // Only allow updates if event is pending
            if (results[0].status !== 'pending') {
                return res.status(403).json({ message: "Only pending events can be edited" });
            }
    
            const { event_name, date_time, venue, description, max_students, total_budget } = req.body;
            db.query("UPDATE events SET event_name=?, date_time=?, venue=?, description=?, max_students=?, total_budget=? WHERE id=?", 
                [event_name, date_time, venue, description, max_students, total_budget, req.params.id], (err, result) => {
                if (err) return res.status(500).json({ error: err.message });
                if (result.affectedRows === 0) return res.status(404).json({ message: "Event not found" });
                res.json({ message: "Event updated successfully" });
            });
        });
    });

    
    // ✅ Delete Event
    app.delete("/cancel-event/:id", verifyToken, (req, res) => {
        db.query("DELETE FROM events WHERE id=?", [req.params.id], (err) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ message: "Event canceled successfully" });
        }); 
    });

    // ✅ Get Event Reports
// ✅ Get Event Reports
app.get("/event-reports", verifyToken, async (req, res) => {
    if (req.user.role !== "admin") return res.status(403).json({ message: "Access Denied!" });

    try {
        // Get counts by status
        const [statusCounts] = await db.promise().query(`
            SELECT 
                status,
                COUNT(*) as count
            FROM events
            GROUP BY status
        `);

        // Get events by month
        const [monthlyEvents] = await db.promise().query(`
            SELECT 
                DATE_FORMAT(date_time, '%Y-%m') as month,
                COUNT(*) as event_count
            FROM events
            GROUP BY DATE_FORMAT(date_time, '%Y-%m')
            ORDER BY month DESC
            LIMIT 6
        `);

        // Get registration statistics - FIXED QUERY
        const [registrationStats] = await db.promise().query(`
            SELECT 
                e.id,
                e.event_name,
                e.max_students,
                COUNT(r.id) as registered_count,
                ROUND(COUNT(r.id) / e.max_students * 100) as fill_percentage
            FROM events e
            LEFT JOIN registrations r ON e.id = r.event_id AND r.status = 'Registered'
            WHERE e.status = 'approved'
            GROUP BY e.id
            ORDER BY fill_percentage DESC
            LIMIT 5
        `);

        res.json({
            statusCounts,
            monthlyEvents,
            registrationStats
        });

    } catch (error) {
        console.error("Error generating reports:", error);
        res.status(500).json({ message: "Error generating reports", error: error.message });
    }
});
// ✅ Get Organizer Event Reports
app.get("/organizer-event-reports", verifyToken, async (req, res) => {
    const organizerId = req.user.id;

    try {
        // Get counts by status for this organizer
        const [statusCounts] = await db.promise().query(`
            SELECT 
                status,
                COUNT(*) as count
            FROM events
            WHERE organizer_id = ?
            GROUP BY status
        `, [organizerId]);

        // Get events by month for this organizer
        const [monthlyEvents] = await db.promise().query(`
            SELECT 
                DATE_FORMAT(date_time, '%Y-%m') as month,
                COUNT(*) as event_count
            FROM events
            WHERE organizer_id = ?
            GROUP BY DATE_FORMAT(date_time, '%Y-%m')
            ORDER BY month DESC
            LIMIT 6
        `, [organizerId]);

        // Get registration statistics for this organizer's events
        const [registrationStats] = await db.promise().query(`
            SELECT 
                e.id,
                e.event_name,
                e.max_students,
                COUNT(r.id) as registered_count,
                ROUND(COUNT(r.id) / e.max_students * 100) as fill_percentage
            FROM events e
            LEFT JOIN registrations r ON e.id = r.event_id AND r.status = 'Registered'
            WHERE e.organizer_id = ? AND e.status = 'approved'
            GROUP BY e.id
            ORDER BY fill_percentage DESC
            LIMIT 5
        `, [organizerId]);

        res.json({
            statusCounts,
            monthlyEvents,
            registrationStats
        });

    } catch (error) {
        console.error("Error generating organizer reports:", error);
        res.status(500).json({ message: "Error generating reports", error: error.message });
    }
});
// ✅ Get Organizer Event Reports
app.get("/organizer-event-reports", verifyToken, async (req, res) => {
    const organizerId = req.user.id;

    try {
        // Get counts by status for this organizer
        const [statusCounts] = await db.promise().query(`
            SELECT 
                status,
                COUNT(*) as count
            FROM events
            WHERE organizer_id = ?
            GROUP BY status
        `, [organizerId]);

        // Get events by month for this organizer
        const [monthlyEvents] = await db.promise().query(`
            SELECT 
                DATE_FORMAT(date_time, '%Y-%m') as month,
                COUNT(*) as event_count
            FROM events
            WHERE organizer_id = ?
            GROUP BY DATE_FORMAT(date_time, '%Y-%m')
            ORDER BY month DESC
            LIMIT 6
        `, [organizerId]);

        // Get registration statistics for this organizer
        const [registrationStats] = await db.promise().query(`
            SELECT 
                e.id,
                e.event_name,
                e.max_students,
                COUNT(r.id) as registered_count,
                ROUND(COUNT(r.id) / e.max_students * 100) as fill_percentage
            FROM events e
            LEFT JOIN registrations r ON e.id = r.event_id AND r.status = 'Registered'
            WHERE e.organizer_id = ? AND e.status = 'approved'
            GROUP BY e.id
            ORDER BY fill_percentage DESC
            LIMIT 5
        `, [organizerId]);

        res.json({
            statusCounts,
            monthlyEvents,
            registrationStats
        });

    } catch (error) {
        console.error("Error generating organizer reports:", error);
        res.status(500).json({ message: "Error generating reports", error: error.message });
    }
});
    // ✅ Start Server
    const PORT = process.env.PORT || 3000;
    app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
