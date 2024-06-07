const express = require('express');
const bodyParser = require('body-parser');
const mysql = require('mysql');
const { OAuth2Client } = require('google-auth-library');
const admin = require('firebase-admin');
const serviceAccount = require('./firebase-service-account.json'); // Update the path if necessary
const cors = require('cors');

const app = express();
const port = 3000; // Choose a port different from your MySQL port

const client = new OAuth2Client('274956882933-mlfraac6hed4vsn4pitt3vpndkd80k5p.apps.googleusercontent.com'); // Replace with your Google OAuth client ID

const db = mysql.createConnection({
    host: 'localhost', // or the IP address of your server
    user: 'root', // Your MySQL username
    password: '123', // Your MySQL password
    database: 'inferno' // The name of your database
});

db.connect(err => {
    if (err) {
        console.error('Database connection failed:', err.stack);
        return;
    }
    console.log('Database connected as id ' + db.threadId);
});

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    storageBucket: 'inferno-1a6a8.appspot.com' // Replace with your Firebase storage bucket name
});

const bucket = admin.storage().bucket();

app.use(bodyParser.json());
app.use(cors()); // Добавьте это для включения CORS

app.post('/signup', (req, res) => {
    const { fullName, email, password } = req.body;
    const query = 'INSERT INTO user (username, email, password) VALUES (?, ?, ?)';
    db.query(query, [fullName, email, password], (err, result) => {
        if (err) {
            console.error('Error executing query:', err.stack);
            res.status(500).send({ error: 'Database query failed' });
            return;
        }
        res.send({ message: 'User registered successfully', userId: result.insertId }); // Возвращаем userId
    });
});

app.post('/login', (req, res) => {
    const { email, password } = req.body;
    const query = 'SELECT user_id FROM user WHERE email = ? AND password = ?';
    db.query(query, [email, password], (err, results) => {
        if (err) {
            console.error('Error executing query:', err.stack);
            res.status(500).send({ error: 'Database query failed' });
            return;
        }
        if (results.length > 0) {
            const userId = results[0].user_id;
            res.send({ success: true, userId: userId }); // Возвращаем ID пользователя
        } else {
            res.status(401).send({ success: false, message: 'Invalid email or password' });
        }
    });
});

app.post('/google-login', async (req, res) => {
    const { idToken } = req.body;
    try {
        const ticket = await client.verifyIdToken({
            idToken,
            audience: '274956882933-mlfraac6hed4vsn4pitt3vpndkd80k5p.apps.googleusercontent.com', // Specify your Google OAuth client ID
        });
        const payload = ticket.getPayload();
        const email = payload.email;

        // Check if the user already exists in the database
        const query = 'SELECT user_id FROM user WHERE email = ?';
        db.query(query, [email], (err, results) => {
            if (err) {
                console.error('Error executing query:', err.stack);
                res.status(500).send({ error: 'Database query failed' });
                return;
            }
            if (results.length > 0) {
                res.send({ success: true, userId: results[0].user_id });
            } else {
                // Register the user if not already in the database
                const newUserQuery = 'INSERT INTO user (email) VALUES (?)';
                db.query(newUserQuery, [email], (err, result) => {
                    if (err) {
                        console.error('Error executing query:', err.stack);
                        res.status(500).send({ error: 'Database query failed' });
                        return;
                    }
                    res.send({ success: true, userId: result.insertId });
                });
            }
        });
    } catch (error) {
        console.error('Error verifying Google ID token:', error);
        res.status(401).send({ success: false, message: 'Invalid ID token' });
    }
});

app.get('/profile', (req, res) => {
    const userId = req.query.userId;
    if (!userId) {
        return res.status(400).send({ error: 'User ID is required' });
    }

    const profileQuery = `
        SELECT 
            u.username,
            p.avatar,
            (SELECT COUNT(*) FROM userachieve WHERE user_id = ?) as achievementsCount,
            (SELECT COUNT(*) FROM result WHERE user_id = ?) as quizzesCount
        FROM user u
        JOIN profile p ON u.user_id = p.user_id
        WHERE u.user_id = ?
    `;

    db.query(profileQuery, [userId, userId, userId], (err, results) => {
        if (err) {
            console.error('Error executing query:', err.stack);
            res.status(500).send({ error: 'Database query failed' });
            return;
        }
        if (results.length > 0) {
            res.json(results[0]);
        } else {
            res.status(404).send({ error: 'Profile not found' });
        }
    });
});

app.get('/quizzes', (req, res) => {
    const query = 'SELECT * FROM quiz ORDER BY currency_amount DESC LIMIT 3';
    db.query(query, async (err, results) => {
        if (err) {
            console.error('Error executing query:', err.stack);
            res.status(500).send({ error: 'Database query failed' });
            return;
        }

        // Add URLs to quizzes
        const quizzesWithUrls = await Promise.all(results.map(async quiz => {
            const filePath = quiz.image_url.replace('gs://inferno-1a6a8.appspot.com/', '');
            const [file] = await bucket.file(filePath).getSignedUrl({
                action: 'read',
                expires: '03-09-2491'
            });
            return { ...quiz, image_url: file };
        }));

        res.send(quizzesWithUrls);
    });
});


app.get('/quiz', (req, res) => {
    const query = 'SELECT quiz_id, title, image_url, currency_amount AS rating FROM quiz';
    db.query(query, async (err, results) => {
        if (err) {
            console.error('Error executing query:', err.stack);
            res.status(500).send({ error: 'Database query failed' });
            return;
        }

        // Add URLs to quizzes
        const quizzesWithUrls = await Promise.all(results.map(async quiz => {
            const filePath = quiz.image_url.replace('gs://inferno-1a6a8.appspot.com/', '');
            const [file] = await bucket.file(filePath).getSignedUrl({
                action: 'read',
                expires: '03-09-2491'
            });
            return { ...quiz, image_url: file };
        }));

        console.log(quizzesWithUrls);
        res.send(quizzesWithUrls);
    });
});

app.get('/quiz_info/:id', (req, res) => {
    const quizId = req.params.id;
    const query = 'SELECT quiz_id, title, image_url, description, currency_amount FROM quiz WHERE quiz_id = ?';

    db.query(query, [quizId], async (err, results) => {
        if (err) {
            console.error('Error executing query:', err.stack);
            res.status(500).send({ error: 'Database query failed' });
            return;
        }

        if (results.length === 0) {
            res.status(404).send({ error: 'Quiz not found' });
            return;
        }

        const quiz = results[0];
        const filePath = quiz.image_url.replace('gs://inferno-1a6a8.appspot.com/', '');
        const [file] = await bucket.file(filePath).getSignedUrl({
            action: 'read',
            expires: '03-09-2491'
        });

        const quizWithUrl = {
            title: quiz.title,
            image_url: file,
            description: quiz.description,
        };

        res.send(quizWithUrl);
    });
});


app.get('/search', (req, res) => {
    const { query } = req.query;
    const searchQuery = `
        SELECT * FROM quiz 
        WHERE title LIKE ? OR description LIKE ? OR theme LIKE ?
    `;
    const queryParam = `%${query}%`;
    db.query(searchQuery, [queryParam, queryParam, queryParam], async (err, results) => {
        if (err) {
            console.error('Error executing search query:', err.stack);
            res.status(500).send({ error: 'Database search query failed' });
            return;
        }

        const quizzesWithUrls = await Promise.all(results.map(async quiz => {
            const filePath = quiz.image_url.replace('gs://inferno-1a6a8.appspot.com/', '');
            const [file] = await bucket.file(filePath).getSignedUrl({
                action: 'read',
                expires: '03-09-2491'
            });
            return { ...quiz, image_url: file };
        }));

        res.send(quizzesWithUrls);
    });
});

app.post('/google-login', async (req, res) => {
    const { idToken } = req.body;
    try {
        const ticket = await client.verifyIdToken({
            idToken,
            audience: '274956882933-mlfraac6hed4vsn4pitt3vpndkd80k5p.apps.googleusercontent.com', // Specify your Google OAuth client ID
        });
        const payload = ticket.getPayload();
        const email = payload.email;

        // Check if the user already exists in the database
        const query = 'SELECT * FROM user WHERE email = ?';
        db.query(query, [email], (err, results) => {
            if (err) {
                console.error('Error executing query:', err.stack);
                res.status(500).send({ error: 'Database query failed' });
                return;
            }
            if (results.length > 0) {
                res.send({ success: true, message: 'Login successful' });
            } else {
                // Register the user if not already in the database
                const newUserQuery = 'INSERT INTO user (email) VALUES (?)';
                db.query(newUserQuery, [email], (err, result) => {
                    if (err) {
                        console.error('Error executing query:', err.stack);
                        res.status(500).send({ error: 'Database query failed' });
                        return;
                    }
                    res.send({ success: true, message: 'User registered and login successful' });
                });
            }
        });
    } catch (error) {
        console.error('Error verifying Google ID token:', error);
        res.status(401).send({ success: false, message: 'Invalid ID token' });
    }
});

app.post('/update-profile', (req, res) => {
    const { fullName, email, password, avatar } = req.body;
    const query = 'UPDATE user u JOIN profile p ON u.user_id = p.user_id SET u.username = ?, u.email = ?, u.password = ?, p.avatar = ? WHERE u.user_id = ?';
    db.query(query, [fullName, email, password, avatar, req.body.userId], (err, result) => {
        if (err) {
            console.error('Error executing query:', err.stack);
            res.status(500).send({ error: 'Database query failed' });
            return;
        }
        res.send({ message: 'Profile updated successfully' });
    });
});

app.get('/my-quizzes', async (req, res) => {
    const userId = req.query.userId;
    if (!userId) {
      return res.status(400).send({ error: 'User ID is required' });
    }
  
    const query = `
      SELECT q.quiz_id, q.title, q.image_url, r.score, 
             (SELECT COUNT(*) FROM question WHERE quiz_id = q.quiz_id) AS totalQuestions
      FROM result r
      JOIN quiz q ON r.quiz_id = q.quiz_id
      WHERE r.user_id = ?
    `;
  
    db.query(query, [userId], async (err, results) => {
      if (err) {
        console.error('Error executing query:', err.stack);
        res.status(500).send({ error: 'Database query failed' });
        return;
      }
  
      // Преобразование gs:// ссылок в HTTP ссылки
      const quizzesWithUrls = await Promise.all(results.map(async quiz => {
        if (quiz.image_url.startsWith('gs://')) {
          const filePath = quiz.image_url.replace('gs://inferno-1a6a8.appspot.com/', '');
          const [file] = await bucket.file(filePath).getSignedUrl({
            action: 'read',
            expires: '03-09-2491'
          });
          quiz.image_url = file;
        }
        return quiz;
      }));
  
      res.json(quizzesWithUrls);
    });
  });
  
  app.get('/achievements', (req, res) => {
    const userId = req.query.userId;
    if (!userId) {
        return res.status(400).send({ error: 'User ID is required' });
    }

    const achievementsQuery = `
        SELECT 
            a.achieve_id,
            a.name,
            a.description,
            IF(ua.user_id IS NULL, 0, 1) AS achieved
        FROM achieve a
        LEFT JOIN userachieve ua ON a.achieve_id = ua.achieve_id AND ua.user_id = ?
    `;

    db.query(achievementsQuery, [userId], (err, results) => {
        if (err) {
            console.error('Error executing query:', err.stack);
            res.status(500).send({ error: 'Database query failed' });
            return;
        }
        res.json(results);
    });
}); 

app.get('/check-premium', (req, res) => {
    const userId = req.query.userId;
    if (!userId) {
        return res.status(400).send({ error: 'User ID is required' });
    }

    const query = 'SELECT premium_status FROM profile WHERE user_id = ?';
    db.query(query, [userId], (err, results) => {
        if (err) {
            console.error('Error executing query:', err.stack);
            res.status(500).send({ error: 'Database query failed' });
            return;
        }
        if (results.length > 0) {
            res.send({ premium: results[0].premium_status === 1 });
        } else {
            res.status(404).send({ error: 'Profile not found' });
        }
    });
});


app.post('/create-quiz', async (req, res) => {
    const { title, theme, description, image_url, questions } = req.body;

    try {
        // Сначала создаем викторину
        const quizQuery = 'INSERT INTO quiz (title,description, theme,image_url, difficulty, currency_amount, background_image_url) VALUES (?, ?, ?, ?, "medium", "3", "egwg")';
        db.query(quizQuery, [title, theme, description, image_url], (err, result) => {
            if (err) {
                console.error('Error executing quiz query:', err.stack);
                res.status(500).send({ error: 'Database quiz query failed' });
                return;
            }

            const quizId = result.insertId;

            // Теперь добавляем вопросы
            const questionQueries = questions.map(question => {
                const questionQuery = 'INSERT INTO question (quiz_id, question_text, correct_answer, wrong_answer1, wrong_answer2, wrong_answer3) VALUES (?, ?, ?, ?, ?, ?)';
                return new Promise((resolve, reject) => {
                    db.query(questionQuery, [quizId, question.text, question.correctAnswer, ...question.answers], (err) => {
                        if (err) {
                            console.error('Error executing question query:', err.stack);
                            reject('Database question query failed');
                        } else {
                            resolve();
                        }
                    });
                });
            });

            Promise.all(questionQueries)
                .then(() => {
                    res.send({ message: 'Quiz created successfully' });
                })
                .catch(error => {
                    console.error(error);
                    res.status(500).send({ error });
                });
        });
    } catch (error) {
        console.error('Error creating quiz:', error);
        res.status(500).send({ error: 'Server error' });
    }
});


app.get('/filtered-quizzes', (req, res) => {
    const { topics, ratings, difficulties } = req.query;

    let query = 'SELECT * FROM quiz WHERE 1=1';
    const params = [];

    if (topics) {
        const topicsArray = topics.split(',');
        query += ' AND theme IN (?)';
        params.push(topicsArray);
    }

    if (ratings) {
        const ratingsArray = ratings.split(',').map(r => parseInt(r, 10));
        query += ' AND currency_amount IN (?)';
        params.push(ratingsArray);
    }

    if (difficulties) {
        const difficultiesArray = difficulties.split(',');
        query += ' AND difficulty IN (?)';
        params.push(difficultiesArray);
    }

    db.query(query, params, async (err, results) => {
        if (err) {
            console.error('Error executing query:', err.stack);
            res.status(500).send({ error: 'Database query failed' });
            return;
        }

        const quizzesWithUrls = await Promise.all(results.map(async quiz => {
            const filePath = quiz.image_url.replace('gs://inferno-1a6a8.appspot.com/', '');
            const [file] = await bucket.file(filePath).getSignedUrl({
                action: 'read',
                expires: '03-09-2491'
            });
            return { ...quiz, image_url: file };
        }));

        res.send(quizzesWithUrls);
    });
});



app.get('/quiz_questions/:quizId', async (req, res) => {
    const { quizId } = req.params;
    const query = `
        SELECT q.*, quiz.background_image_url 
        FROM question q 
        JOIN quiz ON q.quiz_id = quiz.quiz_id 
        WHERE q.quiz_id = ?;
    `;

    db.query(query, [quizId], async (err, results) => {
        if (err) {
            console.error('Error fetching questions:', err);
            res.status(500).send({ error: 'Database query failed', details: err.message });
            return;
        }

        if (results.length > 0) {
            const updatedResults = await Promise.all(results.map(async question => {
                if (question.background_image_url) {
                    const filePath = question.background_image_url.replace('gs://inferno-1a6a8.appspot.com/', '');
                    const [fileUrl] = await bucket.file(filePath).getSignedUrl({
                        action: 'read',
                        expires: '03-09-2491'
                    });
                    return { ...question, background_image_url: fileUrl };
                } else {
                    return { ...question, background_image_url: null };
                }
            }));
            res.json(updatedResults);
        } else {
            res.status(404).send({ error: 'No questions found for this quiz' });
        }
    });
})


app.post('/save_result', (req, res) => {
    const { userId, quizId, score, rating } = req.body;

    if (!userId || !quizId || score === undefined || rating === undefined) {
        return res.status(400).send({ error: 'Invalid input data' });
    }

    const insertResultQuery = 'INSERT INTO result (user_id, quiz_id, score, rating, date_taken) VALUES (?, ?, ?, ?, NOW())';
    db.query(insertResultQuery, [userId, quizId, score, rating], (err, result) => {
        if (err) {
            console.error('Error inserting result:', err.stack);
            return res.status(500).send({ error: 'Database query failed at insert result' });
        }

        const updateRatingQuery = `
            UPDATE quiz q
            SET q.currency_amount = (
                SELECT AVG(rating) 
                FROM result 
                WHERE quiz_id = ?
            )
            WHERE q.quiz_id = ?;
        `;

        db.query(updateRatingQuery, [quizId, quizId], (err, result) => {
            if (err) {
                console.error('Error updating quiz rating:', err.stack);
                return res.status(500).send({ error: 'Database query failed at update rating' });
            }

            res.send({ message: 'Result saved and rating updated successfully' });
        });
    });
});



app.listen(port, () => {
    console.log(`Server running on port ${port}`);
});

