// --- Resume Template ---

#let resume(
  author: "",
  location: "",
  email: "",
  phone: "",
  github: "",
  linkedin: "",
  body
) = {
  set page(
    margin: (x: 1.5cm, y: 1.5cm),
    paper: "letter",
  )
  
  set text(
    font: ("Times New Roman"),
    size: 10pt,
  )
  
  // Author Title
  align(center)[
    #block(text(weight: "bold", size: 24pt)[#author])
    #v(-2mm)
    #text(size: 9pt)[
      #if location != "" [#location |]
      #if email != "" [#link("mailto:" + email)[#email] |]
      #if phone != "" [#phone]
    ]
    #v(-2mm)
    #text(size: 9pt)[
      #if github != "" [#link("https://" + github)[#github] |]
      #if linkedin != "" [#link("https://" + linkedin)[#linkedin]]
    ]
  ]
  
  v(5mm)
  
  // Section Headings
  show heading.where(level: 1): it => [
    #v(3mm)
    #text(size: 12pt, weight: "bold", fill: rgb("#2B2B2B"))[#it.body.text.upper()]
    #v(-3mm)
    #line(length: 100%, stroke: 0.5pt + gray)
    #v(1mm)
  ]
  
  body
}

#let edu_item(
  university: "",
  degree: "",
  location: "",
  date: "",
) = {
  grid(
    columns: (1fr, auto),
    [*#university*], [#text(style: "italic")[#location]],
    [#degree], [#text(style: "italic")[#date]],
  )
  v(2mm)
}

#let work_item(
  company: "",
  position: "",
  location: "",
  date: "",
  bullets: (),
) = {
  grid(
    columns: (1fr, auto),
    [*#company*], [#text(style: "italic")[#location]],
    [*#position*], [#text(style: "italic")[#date]],
  )
  v(1mm)
  for bullet in bullets {
    grid(
      columns: (10pt, 1fr),
      [-], [#bullet]
    )
  }
  v(2mm)
}

#let project_item(
  name: "",
  description: "",
  date: "",
  tags: (),
) = {
  grid(
    columns: (1fr, auto),
    [*#name* #if tags.len() > 0 [| #text(size: 8pt, style: "italic")[#tags.join(", ")]]], [#text(style: "italic")[#date]],
  )
  [#description]
  v(2mm)
}
