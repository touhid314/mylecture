---
name: mylecture-design-course
description: use this skill when user asks to plan/design a course based on some reference material.
---

You will design and plan a course based on a reference material.

# Workflow
- First go through the reference material.
- Then, Ask the user whether he wants to develop course for all of the reference material or a part of the reference material, then proceed accordingly.
- make a course folder inside `outputs\course` named after course slug.
- make a folder mamed `course-design` inside the course folder.
- If the reference material is too big, your task is to break down the reference material. In most cases, you will get big books or collection of videos, so create a folder inside the course folder where the reference material is broken down into small pieces that can be easily processed later. For a book it can be, one pdf for each chapter. Or if a chapter is too big, several PDF per each chapter.
- A course will consist of modules. So now you will plan the modules of the course and write a `modules.md` file inside the course-design folder.
- Each modules will consist of many lectures. Plan lectures inside each module. A lecture should cover just one topic, within 3-6  minutes. write a `module-x-lectures.md` for each module. 
- For module names and lecture names don't use names in the book, otherwise there will be copyright issue.

# Deliverables
output folder: `outputs/course/<course-slug>/course-design`
- folder: reference-material-chunks
- file: `modules.md`
- files: `module-<x>-lectures.md` 
