import express from 'express';
import jwt from 'jsonwebtoken';
import { users } from '../users.js';

const router = express.Router();

router.post('/login', (req, res) => {
  const { username, password } = req.body;
  const user = users.find(user => user.user === username && user.password === password);
  if (!user) {
    return res.status(401).json({ message: 'Invalid credentials' });
  }
  const token = jwt.sign(
    { 
      username: user.user,
      role: user.role,
      subteam: user.subteam,
      team: user.team
    }, 
    process.env.JWT_SECRET ,
    { expiresIn: '24h' }
  );

  return res.status(200).json({
    username: user.user,
    role: user.role,
    subteam: user.subteam,
    team: user.team,
    token
  });
});

export default router;